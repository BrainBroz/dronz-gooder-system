import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { PurchaseDetailDrawer } from "../src/components/purchases/PurchaseDetailDrawer";
import { unifiedPurchasesQueryKeys } from "../src/queryKeys";
import type {
  UnifiedPurchaseDetail,
  UnifiedPurchaseItemDetail
} from "../src/types/unified-purchases";
import { renderWithProviders } from "./render";

/**
 * UX-1C — cobertura real das mutações (mapping, assignment, materialização,
 * conflitos). Diferente de purchase-queue.behavior.test.tsx (UX-1B, somente
 * leitura), estes testes exercitam as chamadas de rede efetivas, o
 * comportamento sequencial de assignment, a agregação compra+loja da
 * materialização e a invalidação de cache.
 */

const products = [
  {
    id: "product-new",
    codigo: 500,
    nome: "Produto Novo",
    slug: "produto-novo",
    precoVenda: "10.00",
    markup: "1.5",
    ativo: true,
    categoria: { id: "cat-1", nome: "Categoria", slug: "categoria", ordem: 1, ativo: true }
  }
];

const itemSemMapping: UnifiedPurchaseItemDetail = {
  id: "item-map",
  titulo: "Item Sem Mapping",
  variacao: null,
  skuExterno: null,
  asin: null,
  externalLineIdOriginal: null,
  quantidade: 3,
  quantidadeCancelada: 0,
  quantidadeReembolsada: 0,
  precoUnitario: "50.00",
  moeda: "USD",
  status: "ATIVA",
  version: 1,
  atribuicoes: [],
  mapeamentos: [],
  itensMaterializados: []
};

const itemParaAtribuir: UnifiedPurchaseItemDetail = {
  id: "item-assign",
  titulo: "Item Para Atribuir",
  variacao: null,
  skuExterno: null,
  asin: null,
  externalLineIdOriginal: null,
  quantidade: 5,
  quantidadeCancelada: 0,
  quantidadeReembolsada: 0,
  precoUnitario: "100.00",
  moeda: "USD",
  status: "ATIVA",
  version: 4,
  atribuicoes: [],
  mapeamentos: [
    {
      id: "mapping-1",
      lojaId: "store-dronz",
      produtoId: "product-1",
      version: 1,
      status: "ATIVO",
      produto: { id: "product-1", codigo: 101, nome: "Produto Um" },
      loja: { id: "store-dronz", nome: "Dronz" }
    }
  ],
  itensMaterializados: []
};

const itemProntoMaterializar: UnifiedPurchaseItemDetail = {
  id: "item-materialize",
  titulo: "Item Pronto Para Materializar",
  variacao: null,
  skuExterno: null,
  asin: null,
  externalLineIdOriginal: null,
  quantidade: 5,
  quantidadeCancelada: 0,
  quantidadeReembolsada: 0,
  precoUnitario: "20.00",
  moeda: "USD",
  status: "ATIVA",
  version: 2,
  atribuicoes: [
    {
      id: "assignment-x",
      lojaId: "store-dronz",
      quantidade: 5,
      quantidadeMaterializada: 0,
      version: 1,
      loja: { id: "store-dronz", nome: "Dronz", slug: "dronz" }
    }
  ],
  mapeamentos: [
    {
      id: "mapping-2",
      lojaId: "store-dronz",
      produtoId: "product-2",
      version: 1,
      status: "ATIVO",
      produto: { id: "product-2", codigo: 102, nome: "Produto Dois" },
      loja: { id: "store-dronz", nome: "Dronz" }
    }
  ],
  itensMaterializados: []
};

const itemProntoMaterializar2: UnifiedPurchaseItemDetail = {
  id: "item-materialize-2",
  titulo: "Segundo Item Pronto",
  variacao: null,
  skuExterno: null,
  asin: null,
  externalLineIdOriginal: null,
  quantidade: 2,
  quantidadeCancelada: 0,
  quantidadeReembolsada: 0,
  precoUnitario: "15.00",
  moeda: "USD",
  status: "ATIVA",
  version: 2,
  atribuicoes: [
    {
      id: "assignment-y",
      lojaId: "store-dronz",
      quantidade: 2,
      quantidadeMaterializada: 0,
      version: 1,
      loja: { id: "store-dronz", nome: "Dronz", slug: "dronz" }
    }
  ],
  mapeamentos: [
    {
      id: "mapping-3",
      lojaId: "store-dronz",
      produtoId: "product-3",
      version: 1,
      status: "ATIVO",
      produto: { id: "product-3", codigo: 103, nome: "Produto Três" },
      loja: { id: "store-dronz", nome: "Dronz" }
    }
  ],
  itensMaterializados: []
};

const baseDetail: UnifiedPurchaseDetail = {
  id: "purchase-1",
  plataforma: "AMAZON",
  numeroPedido: "ORDER-1",
  referenciaPesquisavel: "ORDER-1",
  externalOrderIdOriginal: "ORDER-1",
  dataPedido: "2026-07-13T12:00:00.000Z",
  moeda: "USD",
  estado: "EM_REVISAO",
  version: 2,
  contaExterna: null,
  merchantExterno: null,
  merchantExternoId: null,
  itens: [itemSemMapping, itemParaAtribuir, itemProntoMaterializar],
  materializacoes: [],
  conflitos: [
    {
      id: "conflict-1",
      tipo: "PAYLOAD_MISMATCH",
      status: "ABERTO",
      referencia: "ORDER-1",
      motivoResolucao: null,
      createdAt: "2026-07-13T12:00:00.000Z"
    }
  ],
  history: [],
  allowedActions: [
    "SET_PRODUCT_MAPPING",
    "ASSIGN_TO_STORE",
    "MATERIALIZE_STORE_ALLOCATION",
    "RESOLVE_CONFLICT"
  ],
  blockedReasons: [
    { code: "EXTERNAL_ORDER_CONFLICT", message: "Compra possui conflito aberto." }
  ]
};

const detailDuasLojasEligible: UnifiedPurchaseDetail = {
  ...baseDetail,
  itens: [...baseDetail.itens, itemProntoMaterializar2]
};

function installApi(detail: UnifiedPurchaseDetail = baseDetail) {
  vi.spyOn(api, "get").mockImplementation(async (url: string) => {
    if (url === "/imported-purchases/purchase-1") return { data: detail };
    if (url === "/products") return { data: { items: products } };
    throw new Error(`GET inesperado: ${url}`);
  });
}

function renderDrawer(detail: UnifiedPurchaseDetail = baseDetail) {
  installApi(detail);
  return renderWithProviders(
    <PurchaseDetailDrawer purchaseId="purchase-1" onClose={vi.fn()} />
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("UX-1C — Mapeamento de produto", () => {
  it("sucesso: envia storeId real, invalida overview/lists/detail e mantém o drawer aberto", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { id: "mapping-x" } });
    const { queryClient } = renderDrawer();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, payload] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/imported-purchases/items/item-map/product-mappings/store-dronz");
    expect(payload.produtoId).toBe("product-new");
    expect(payload.expectedVersion).toBeUndefined(); // item ainda não tem mapping nesta loja

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: unifiedPurchasesQueryKeys.overview()
      })
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: unifiedPurchasesQueryKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: unifiedPurchasesQueryKeys.detail("purchase-1")
    });

    // drawer permanece aberto — C1
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();
    expect(screen.getByText("Mapear Produto")).toBeTruthy();
  });

  it("erro 400: mantém o drawer aberto e reabilita o botão para nova tentativa", async () => {
    vi.spyOn(api, "put").mockRejectedValue({
      response: { status: 400, data: { message: "produto inválido para esta loja" } }
    });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("produto inválido para esta loja")).toBeTruthy();
    const confirmBtn = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    expect(screen.getByText("Mapear Produto")).toBeTruthy();
  });

  it("erro 409: exibe mensagem de conflito de versão", async () => {
    vi.spyOn(api, "put").mockRejectedValue({ response: { status: 409, data: {} } });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Dados foram atualizados. Recarregando...")).toBeTruthy();
  });
});

describe("UX-1C — Atribuição de quantidade (Assignment)", () => {
  it("sucesso: usa storeId real (não hardcoded) e expectedVersion = item.version", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Atribuir" }));
    const sliders = document.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(2);
    fireEvent.change(sliders[0], { target: { value: "3" } });

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, payload, config] = put.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> }
    ];
    expect(url).toBe("/imported-purchases/items/item-assign/assignments/store-dronz");
    expect(url).not.toContain("dronz_store_id");
    expect(payload).toMatchObject({ quantidade: 3, expectedVersion: 4 });
    expect(config.headers["x-store-id"]).toBe("store-dronz");
  });

  it("duas lojas sequenciais: relê item.version entre as chamadas via refetch", async () => {
    const refreshedDetail: UnifiedPurchaseDetail = {
      ...baseDetail,
      itens: baseDetail.itens.map((item) =>
        item.id === "item-assign" ? { ...item, version: 5 } : item
      )
    };
    let getCalls = 0;
    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === "/imported-purchases/purchase-1") {
        getCalls += 1;
        return { data: getCalls === 1 ? baseDetail : refreshedDetail };
      }
      if (url === "/products") return { data: { items: products } };
      throw new Error(`GET inesperado: ${url}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(<PurchaseDetailDrawer purchaseId="purchase-1" onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Atribuir" }));
    const sliders = document.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: "2" } }); // dronz
    fireEvent.change(sliders[1], { target: { value: "3" } }); // gooder

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    const [firstUrl, firstPayload] = put.mock.calls[0] as [string, Record<string, unknown>];
    const [secondUrl, secondPayload] = put.mock.calls[1] as [string, Record<string, unknown>];

    expect(firstUrl).toContain("/assignments/store-dronz");
    expect(firstPayload).toMatchObject({ quantidade: 2, expectedVersion: 4 });

    expect(secondUrl).toContain("/assignments/store-gooder");
    // versão relida após a primeira chamada, não a mesma versão obsoleta
    expect(secondPayload).toMatchObject({ quantidade: 3, expectedVersion: 5 });
  });

  it("erro parcial: primeira loja é enviada com sucesso antes da segunda falhar", async () => {
    const put = vi
      .spyOn(api, "put")
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({
        response: { status: 400, data: { message: "quantidade inválida" } }
      });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Atribuir" }));
    const sliders = document.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: "2" } });
    fireEvent.change(sliders[1], { target: { value: "3" } });

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("quantidade inválida")).toBeTruthy();
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("erro 409: exibe mensagem de conflito de versão", async () => {
    vi.spyOn(api, "put").mockRejectedValue({ response: { status: 409, data: {} } });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Atribuir" }));
    const sliders = document.querySelectorAll('input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Dados foram atualizados. Recarregando...")).toBeTruthy();
  });
});

describe("UX-1C — Materialização (compra + loja, não por item)", () => {
  it("confirmação: resumo agregado mostra loja, itens elegíveis e total de unidades", async () => {
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Materializar Dronz/ }));

    expect(await screen.findByText("Materializar para Dronz")).toBeTruthy();
    expect(screen.getByText(/todos os itens elegíveis/)).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === "Itens elegíveis: 1 item")
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === "Total de unidades: 5")
    ).toBeTruthy();
  });

  it("sucesso: POST usa storeId + expectedPurchaseVersion e o dialog permanece aberto", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "materialization-1" } });
    const { queryClient } = renderDrawer();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Materializar Dronz/ }));
    await user.click(await screen.findByRole("button", { name: "Materializar" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/imported-purchases/purchase-1/materializations/store-dronz");
    expect(payload).toEqual({ expectedPurchaseVersion: 2 });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: unifiedPurchasesQueryKeys.detail("purchase-1")
      })
    );

    // dialog permanece aberto — C1
    expect(screen.getByText("Materializar para Dronz")).toBeTruthy();
  });

  it("agrega múltiplos itens elegíveis da mesma loja em UMA única chamada", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderDrawer(detailDuasLojasEligible);
    const user = userEvent.setup();

    const trigger = await screen.findByRole("button", {
      name: /Materializar Dronz \(2 itens, 7 un\)/
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Materializar" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty("itemId");
    expect(payload).not.toHaveProperty("itemExternoId");
  });

  it("nunca apresenta um botão de materializar por item isolado", async () => {
    renderDrawer(detailDuasLojasEligible);
    await screen.findByRole("button", { name: /Materializar Dronz \(2 itens, 7 un\)/ });
    expect(screen.queryByRole("button", { name: /item-materialize\)/ })).toBeNull();
    // apenas um botão para a loja Dronz, mesmo havendo dois itens elegíveis
    expect(screen.getAllByRole("button", { name: /Materializar Dronz/ }).length).toBe(1);
  });
});

describe("UX-1C — Resolução de conflitos", () => {
  it("sucesso: POST envia motivo, invalida detail e mantém o drawer aberto", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    const { queryClient } = renderDrawer();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Resolver" }));
    await user.type(
      screen.getByLabelText("Motivo da resolução"),
      "Divergência resolvida manualmente"
    );
    await user.click(screen.getByRole("button", { name: "Resolver Conflito" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/imported-purchases/conflicts/conflict-1/resolve");
    expect(payload).toEqual({ motivo: "Divergência resolvida manualmente" });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: unifiedPurchasesQueryKeys.detail("purchase-1")
      })
    );

    // drawer permanece aberto — C1
    expect(screen.getByLabelText("Motivo da resolução")).toBeTruthy();
  });

  it("erro 404: informa que o conflito não foi encontrado", async () => {
    vi.spyOn(api, "post").mockRejectedValue({ response: { status: 404, data: {} } });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Resolver" }));
    await user.type(screen.getByLabelText("Motivo da resolução"), "Motivo válido aqui");
    await user.click(screen.getByRole("button", { name: "Resolver Conflito" }));

    expect(await screen.findByText("Conflito não encontrado.")).toBeTruthy();
  });

  it("erro 409: informa que outro usuário resolveu o conflito", async () => {
    vi.spyOn(api, "post").mockRejectedValue({ response: { status: 409, data: {} } });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Resolver" }));
    await user.type(screen.getByLabelText("Motivo da resolução"), "Motivo válido aqui");
    await user.click(screen.getByRole("button", { name: "Resolver Conflito" }));

    expect(await screen.findByText("Outro usuário resolveu este conflito.")).toBeTruthy();
  });

  it("motivo é obrigatório: botão só habilita com 5+ caracteres", async () => {
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Resolver" }));
    const submit = () =>
      screen.getByRole("button", { name: "Resolver Conflito" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    await user.type(screen.getByLabelText("Motivo da resolução"), "abcd");
    expect(submit().disabled).toBe(true);

    await user.type(screen.getByLabelText("Motivo da resolução"), "e");
    expect(submit().disabled).toBe(false);
  });
});

describe("UX-1C — Comportamento geral das mutações", () => {
  it("botão fica desabilitado e mostra spinner enquanto a mutation está pendente", async () => {
    let resolvePut!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePut = resolve;
    });
    vi.spyOn(api, "put").mockReturnValue(pending as never);
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Salvando..." }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    resolvePut({ data: {} });
    await waitFor(() => expect(screen.queryByText("Salvando...")).toBeNull());
  });

  it("retry manual: após erro o botão reabilita e uma nova tentativa reenvia a mutation", async () => {
    const put = vi
      .spyOn(api, "put")
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce({ data: {} });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Erro ao mapear produto. Tente novamente.")).toBeTruthy();
    const confirmBtn = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);

    await user.click(confirmBtn);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  });

  it("401 final (já tratado pelo interceptor) apenas exibe mensagem, sem lógica de retry própria", async () => {
    const put = vi.spyOn(api, "put").mockRejectedValue({ response: { status: 401, data: {} } });
    renderDrawer();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mapear produto" }));
    await user.type(screen.getByPlaceholderText("Buscar produto..."), "Novo");
    await user.click(await screen.findByText("Produto Novo"));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Sessão expirada. Fazendo login novamente...")).toBeTruthy();
    // o componente não duplica a lógica de retry do interceptor global (já
    // coberta em fix0.behavior.test.tsx) — apenas exibe a falha propagada.
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("allowedActions ausente esconde a ação mesmo quando o item permitiria", async () => {
    const restricted: UnifiedPurchaseDetail = {
      ...baseDetail,
      allowedActions: ["SET_PRODUCT_MAPPING"]
    };
    renderDrawer(restricted);

    await screen.findByRole("button", { name: "Mapear produto" });
    expect(screen.queryByRole("button", { name: "Atribuir" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Materializar Dronz/ })).toBeNull();
    expect(screen.getByText("Sem ações operacionais disponíveis.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resolver" })).toBeNull();
  });

  it("blockedReasons exibe exatamente a mensagem do backend, sem lógica derivada", async () => {
    const withCustomBlock: UnifiedPurchaseDetail = {
      ...baseDetail,
      blockedReasons: [{ code: "CUSTOM_CODE", message: "Mensagem exata vinda do backend." }]
    };
    renderDrawer(withCustomBlock);

    expect(await screen.findByText("Mensagem exata vinda do backend.")).toBeTruthy();
  });
});
