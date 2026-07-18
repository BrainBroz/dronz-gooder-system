import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { NewPurchaseDrawer } from "../src/components/purchases/NewPurchaseDrawer";
import { PurchaseQueuePage } from "../src/pages/PurchaseQueuePage";
import { useAuthStore } from "../src/stores/auth";
import type { UnifiedPurchaseListItem } from "../src/types/unified-purchases";
import { renderWithProviders } from "./render";

/**
 * UX-1E.1 — "+ Nova compra" (Manual / Externa) + criação contextual de
 * merchant. Cobertura real de rede (URL, payload, headers), não apenas
 * presença de texto.
 */

const permissions = ["COMPRAS_IMPORTADAS_VISUALIZAR", "COMPRAS_IMPORTADAS_IMPORTAR"];
const permissionsWithMerchant = [...permissions, "MAPPING_FORNECEDOR_GERENCIAR"];

const listItems: UnifiedPurchaseListItem[] = [
  {
    id: "purchase-1",
    provider: "AMAZON",
    account: { id: "account-1", name: "Conta Amazon Principal" },
    merchant: { id: "merchant-1", name: "Merchant Árvore" },
    reference: "ORDER-1",
    orderedAt: "2026-07-01T12:00:00.000Z",
    currency: "USD",
    state: "EM_REVISAO",
    itemCount: 1,
    progress: { total: 1, assigned: 0, materialized: 0, pending: 1 },
    conflictCount: 0,
    allowedActions: [],
    blockedReasons: []
  }
];

const products = [
  {
    id: "product-1",
    codigo: 301,
    nome: "Produto Dronz",
    slug: "produto-dronz",
    precoVenda: "10.00",
    markup: "1.5",
    ativo: true,
    categoria: { id: "cat-1", nome: "Categoria", slug: "categoria", ordem: 1, ativo: true }
  }
];

function installProductsApi() {
  vi.spyOn(api, "get").mockImplementation(async (url: string) => {
    if (url === "/products") return { data: { items: products } };
    throw new Error(`GET inesperado: ${url}`);
  });
}

async function selectMuiOption(label: string, option: string, scope: typeof screen = screen) {
  const user = userEvent.setup();
  await user.click(scope.getByLabelText(label, { exact: false }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PurchaseQueuePage — botão + Nova compra", () => {
  function installQueueApi() {
    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === "/imported-purchases/overview")
        return {
          data: {
            totalOrders: 0,
            totalItems: 0,
            unassigned: 0,
            partiallyAssigned: 0,
            fullyAssigned: 0,
            materialized: 0,
            pending: 0,
            conflicts: 0,
            mappingsPending: 0,
            byProvider: {},
            allowedActions: []
          }
        };
      if (url === "/imported-purchases")
        return { data: { items: listItems, page: 1, limit: 20, total: 1 } };
      throw new Error(`GET inesperado: ${url}`);
    });
  }

  it("aparece com COMPRAS_IMPORTADAS_IMPORTAR e abre o drawer sem origens futuras visíveis", async () => {
    installQueueApi();
    const user = userEvent.setup();
    renderWithProviders(<PurchaseQueuePage />, { permissions });

    const button = await screen.findByRole("button", { name: "+ Nova compra" });
    await user.click(button);

    expect(await screen.findByText("Nova compra")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manual" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Externa" })).toBeTruthy();
    expect(screen.queryByText(/e-mail/i)).toBeNull();
    expect(screen.queryByText(/amazon api/i)).toBeNull();
    expect(screen.queryByText(/ebay api/i)).toBeNull();
  });

  it("fica oculto sem COMPRAS_IMPORTADAS_IMPORTAR", async () => {
    installQueueApi();
    renderWithProviders(<PurchaseQueuePage />, {
      permissions: ["COMPRAS_IMPORTADAS_VISUALIZAR"]
    });
    await screen.findByText("Compras");
    expect(screen.queryByRole("button", { name: "+ Nova compra" })).toBeNull();
  });
});

describe("NewPurchaseDrawer — Compra manual", () => {
  it("sucesso: envia payload exato com idempotency key e mantém o drawer aberto", async () => {
    installProductsApi();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "purchase-new-1" } });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-001");
    await user.type(screen.getByLabelText("Item"), "Item manual");

    await user.click(screen.getByRole("button", { name: "Criar compra manual" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload, config] = post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> }
    ];
    expect(url).toBe("/imported-purchases/manual");
    expect(payload).toMatchObject({
      referencia: "MANUAL-001",
      lojaId: "store-dronz",
      merchantExternoId: "merchant-1",
      moeda: "USD",
      itens: [
        {
          titulo: "Item manual",
          quantidade: 1,
          precoUnitario: 0,
          moeda: "USD",
          produtoId: "product-1"
        }
      ]
    });
    expect(config.headers["idempotency-key"]).toEqual(expect.any(String));
    expect(config.headers["x-store-id"]).toBe("store-dronz");

    // drawer permanece aberto — mostra sucesso, não fecha sozinho
    expect(await screen.findByText("Compra manual criada.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Criar compra manual" })).toBeTruthy();
  });

  it("erro: mantém o formulário aberto com os dados preenchidos", async () => {
    installProductsApi();
    vi.spyOn(api, "post").mockRejectedValue({
      response: { status: 400, data: { message: "produto não pertence à loja" } }
    });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-002");
    await user.type(screen.getByLabelText("Item"), "Item manual 2");
    await user.click(screen.getByRole("button", { name: "Criar compra manual" }));

    expect(await screen.findByText("produto não pertence à loja")).toBeTruthy();
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "MANUAL-002"
    );
    expect((screen.getByLabelText("Item") as HTMLInputElement).value).toBe(
      "Item manual 2"
    );
  });

  it("botão de criar compra fica desabilitado até os campos obrigatórios estarem preenchidos", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manual" }));

    const submit = screen.getByRole("button", { name: "Criar compra manual" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("trocar de loja reseta o produto selecionado (não envia produto de outra loja)", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Produto", "301 — Produto Dronz");

    const productCombobox = screen.getByRole("combobox", { name: /Produto/i });
    expect(productCombobox.textContent).toContain("301");

    await selectMuiOption("Loja", "Gooder");

    expect(productCombobox.textContent).not.toContain("301");
  });

  it("estado pendente: bloqueia Fechar/Trocar origem/ESC/backdrop, permite só uma chamada de rede e restaura os controles após resolver", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockReturnValue(pending as never);
    const onClose = vi.fn();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={onClose} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-PEND");
    await user.type(screen.getByLabelText("Item"), "Item pendente");

    const submit = screen.getByRole("button", { name: "Criar compra manual" });
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    // duplo clique durante pending: o próprio botão fica disabled (o browser
    // real bloqueia cliques nele; userEvent lança erro ao tentar, o que já
    // prova o bloqueio), então a segunda chamada nunca é uma possibilidade.
    expect((screen.getByRole("button", { name: /Salvando/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (screen.getByRole("button", { name: "← Trocar origem" }) as HTMLButtonElement).disabled
    ).toBe(true);
    // formulário inteiro congelado: merchant e ação de criar merchant também
    expect(
      (screen.getByRole("combobox", { name: /Merchant/i }) as HTMLElement).getAttribute(
        "aria-disabled"
      )
    ).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Criar novo merchant" }) as HTMLButtonElement).disabled
    ).toBe(true);

    // ESC não fecha
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    // backdrop não fecha
    const backdrop = document.querySelector(".MuiBackdrop-root") as HTMLElement | null;
    if (backdrop) await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    // drawer continua montado com os dados intactos
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "MANUAL-PEND"
    );

    resolvePost({ data: { id: "purchase-pend-1" } });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Compra manual criada.")).toBeTruthy();

    expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(
      (screen.getByRole("button", { name: "← Trocar origem" }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});

describe("NewPurchaseDrawer — Compra externa", () => {
  it("sucesso via sugestão: envia payload exato usando conta/merchant sugeridos", async () => {
    installProductsApi();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "purchase-ext-1" } });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Conta Amazon Principal · AMAZON");
    await user.type(screen.getByLabelText("Número externo"), "EXT-001");
    await user.type(screen.getByLabelText("Referência"), "Pedido Externo");
    await user.type(screen.getByLabelText("Item"), "Produto Externo");

    await user.click(screen.getByRole("button", { name: "Registrar compra externa" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/imported-purchases");
    expect(payload).toMatchObject({
      plataforma: "AMAZON",
      contaExternaId: "account-1",
      externalOrderId: "EXT-001",
      referencia: "Pedido Externo",
      origem: "API",
      itens: [expect.objectContaining({ titulo: "Produto Externo" })]
    });

    expect(await screen.findByText("Compra registrada.")).toBeTruthy();
  });

  it("fallback de ID cru: aceita conta que não está nas sugestões", async () => {
    installProductsApi();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Informar ID manualmente…");
    await user.type(
      screen.getByLabelText("Conta externa (ID)", { exact: false }),
      "conta-fora-da-lista-123"
    );
    await user.type(screen.getByLabelText("Número externo"), "EXT-002");
    await user.type(screen.getByLabelText("Referência"), "Pedido Fallback");
    await user.type(screen.getByLabelText("Item"), "Produto Fallback");

    await user.click(screen.getByRole("button", { name: "Registrar compra externa" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toMatchObject({ contaExternaId: "conta-fora-da-lista-123" });
  });

  it("erro: mantém o formulário aberto com a mensagem do backend", async () => {
    installProductsApi();
    vi.spyOn(api, "post").mockRejectedValue({
      response: { status: 409, data: { message: "pedido externo já registrado" } }
    });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Conta Amazon Principal · AMAZON");
    await user.type(screen.getByLabelText("Número externo"), "EXT-003");
    await user.type(screen.getByLabelText("Referência"), "Pedido Erro");
    await user.type(screen.getByLabelText("Item"), "Produto Erro");
    await user.click(screen.getByRole("button", { name: "Registrar compra externa" }));

    expect(await screen.findByText("pedido externo já registrado")).toBeTruthy();
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "Pedido Erro"
    );
  });

  it("sugestões vazias: cai direto no modo de ID manual sem bloquear o formulário", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={[]} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Externa" }));

    expect(screen.getByLabelText("Conta externa (ID)", { exact: false })).toBeTruthy();
    expect(screen.queryByText(/Ver sugestões/)).toBeNull();
  });

  it("estado pendente: bloqueia Fechar e Trocar origem durante o registro", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockReturnValue(pending as never);
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Conta Amazon Principal · AMAZON");
    await user.type(screen.getByLabelText("Número externo"), "EXT-PEND");
    await user.type(screen.getByLabelText("Referência"), "Pedido Pendente");
    await user.type(screen.getByLabelText("Item"), "Item pendente");
    await user.click(screen.getByRole("button", { name: "Registrar compra externa" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (screen.getByRole("button", { name: "← Trocar origem" }) as HTMLButtonElement).disabled
    ).toBe(true);

    resolvePost({ data: {} });
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
        false
      )
    );
  });
});

describe("NewPurchaseDrawer — troca de origem", () => {
  it("Manual → Externa → Manual não vaza dados entre formulários", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await user.type(screen.getByLabelText("Referência"), "MANUAL-LEAK-TEST");

    await user.click(screen.getByRole("button", { name: "← Trocar origem" }));
    await user.click(screen.getByRole("button", { name: "Externa" }));

    // formulário externo não deve ter nenhum resquício do valor digitado no manual
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe("");

    await user.click(screen.getByRole("button", { name: "← Trocar origem" }));
    await user.click(screen.getByRole("button", { name: "Manual" }));

    // formulário manual voltou do zero, não reteve o valor anterior
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe("");
  });
});

describe("NewPurchaseDrawer — Merchant contextual", () => {
  it("ação fica escondida sem MAPPING_FORNECEDOR_GERENCIAR", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions } // sem MAPPING_FORNECEDOR_GERENCIAR
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manual" }));

    expect(screen.queryByRole("button", { name: "Criar novo merchant" })).toBeNull();
  });

  it("ID retornado pela criação chega intacto ao payload final da compra manual (usuário não copia nada)", async () => {
    installProductsApi();
    const post = vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === "/imported-purchases/merchants") return { data: { id: "merchant-created-1" } };
      if (url === "/imported-purchases/manual") return { data: { id: "purchase-e2e-1" } };
      throw new Error(`POST inesperado: ${url}`);
    });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-E2E");
    await user.type(screen.getByLabelText("Item"), "Item e2e");

    await user.click(screen.getByRole("button", { name: "Criar novo merchant" }));
    await user.type(screen.getByLabelText("Nome do merchant", { exact: false }), "Merchant E2E");
    await user.click(screen.getByRole("button", { name: "Criar merchant" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/imported-purchases/merchants",
        expect.objectContaining({ nome: "Merchant E2E" }),
        expect.anything()
      )
    );

    // dados principais preenchidos antes da criação continuam intactos depois
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "MANUAL-E2E"
    );
    expect((screen.getByLabelText("Item") as HTMLInputElement).value).toBe("Item e2e");

    await user.click(screen.getByRole("button", { name: "Criar compra manual" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/imported-purchases/manual",
        expect.objectContaining({ merchantExternoId: "merchant-created-1" }),
        expect.anything()
      )
    );
  });

  it("erro na criação não substitui o merchant já selecionado e não limpa o formulário", async () => {
    installProductsApi();
    vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === "/imported-purchases/merchants")
        return Promise.reject({
          response: { status: 400, data: { message: "nome do merchant inválido" } }
        });
      throw new Error(`POST inesperado: ${url}`);
    });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-CTX");

    await user.click(screen.getByRole("button", { name: "Criar novo merchant" }));
    await user.type(screen.getByLabelText("Nome do merchant", { exact: false }), "X");
    await user.click(screen.getByRole("button", { name: "Criar merchant" }));

    expect(await screen.findByText("nome do merchant inválido")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    // merchant original ainda selecionado, formulário principal intacto
    const merchantCombobox = screen.getByRole("combobox", { name: /Merchant/i });
    expect(merchantCombobox.textContent).toContain("Merchant Árvore");
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "MANUAL-CTX"
    );
  });

  it("merchant contextual pendente: bloqueia Fechar/Trocar origem/ESC/backdrop até a criação terminar", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url === "/imported-purchases/merchants") return pending as never;
      throw new Error(`POST inesperado: ${url}`);
    });
    const onClose = vi.fn();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={onClose} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await user.click(screen.getByRole("button", { name: "Criar novo merchant" }));
    await user.type(screen.getByLabelText("Nome do merchant", { exact: false }), "Merchant Pend");
    await user.click(screen.getByRole("button", { name: "Criar merchant" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    // a mutação pendente é a do merchant contextual, não a da compra — ainda
    // assim o drawer inteiro precisa ficar preso até ela terminar. A
    // propagação passa por dois níveis de efeito (criador → formulário →
    // drawer), então aguarda o commit terminar antes de checar `disabled`.
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
        true
      )
    );
    expect(
      (screen.getByRole("button", { name: "← Trocar origem" }) as HTMLButtonElement).disabled
    ).toBe(true);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = document.querySelector(".MuiBackdrop-root") as HTMLElement | null;
    if (backdrop) await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    resolvePost({ data: { id: "merchant-pend-1" } });
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement).disabled).toBe(
        false
      )
    );
  });

  it("duplo clique real (merchant contextual): apenas uma chamada de rede, mesmo antes do rerender aplicar disabled", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockImplementation((url: string) => {
      if (url === "/imported-purchases/merchants") return pending as never;
      throw new Error(`POST inesperado: ${url}`);
    });
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await user.click(screen.getByRole("button", { name: "Criar novo merchant" }));
    await user.type(screen.getByLabelText("Nome do merchant", { exact: false }), "Merchant Dbl");

    const createButton = screen.getByRole("button", { name: "Criar merchant" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolvePost({ data: { id: "merchant-dbl-1" } });
  });
});

describe("NewPurchaseDrawer — duplo clique real (trava síncrona, não apenas disabled)", () => {
  it("Manual: apenas uma chamada de rede mesmo com dois cliques síncronos", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockReturnValue(pending as never);
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-DBL");
    await user.type(screen.getByLabelText("Item"), "Item duplo clique");

    const submit = screen.getByRole("button", { name: "Criar compra manual" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolvePost({ data: { id: "purchase-dbl-1" } });
  });

  it("Externa: apenas uma chamada de rede mesmo com dois cliques síncronos", async () => {
    installProductsApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockReturnValue(pending as never);
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Conta Amazon Principal · AMAZON");
    await user.type(screen.getByLabelText("Número externo"), "EXT-DBL");
    await user.type(screen.getByLabelText("Referência"), "Pedido Duplo");
    await user.type(screen.getByLabelText("Item"), "Item duplo");

    const submit = screen.getByRole("button", { name: "Registrar compra externa" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolvePost({ data: {} });
  });
});

describe("NewPurchaseDrawer — respeita a loja ativa", () => {
  it("compra manual inicia pela activeStoreId autorizada, não pela primeira loja da lista", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant, activeStoreId: "store-gooder" }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manual" }));

    const lojaCombobox = screen.getByRole("combobox", { name: /Loja/i });
    expect(lojaCombobox.textContent).toContain("Gooder");
    expect(lojaCombobox.textContent).not.toContain("Dronz");
  });

  it("troca real de activeStoreId (fora do select interno) atualiza a loja e reseta o produto incompatível", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant, activeStoreId: "store-gooder" }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Produto", "301 — Produto Dronz");

    const productCombobox = screen.getByRole("combobox", { name: /Produto/i });
    expect(productCombobox.textContent).toContain("301");

    useAuthStore.setState({ activeStoreId: "store-dronz" });

    const lojaCombobox = screen.getByRole("combobox", { name: /Loja/i });
    await waitFor(() => expect(lojaCombobox.textContent).toContain("Dronz"));
    expect(productCombobox.textContent).not.toContain("301");
  });
});

describe("NewPurchaseDrawer — compatibilidade por plataforma (compra externa)", () => {
  it("trocar plataforma limpa a conta externa incompatível já selecionada", async () => {
    installProductsApi();
    renderWithProviders(
      <NewPurchaseDrawer open={true} onClose={vi.fn()} listItems={listItems} />,
      { permissions: permissionsWithMerchant }
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Externa" }));
    await selectMuiOption("Conta externa", "Conta Amazon Principal · AMAZON");

    const contaCombobox = screen.getByRole("combobox", { name: /Conta externa/i });
    expect(contaCombobox.textContent).toContain("Conta Amazon Principal");

    await selectMuiOption("Plataforma", "EBAY");

    expect(contaCombobox.textContent).not.toContain("Conta Amazon Principal");
  });
});

describe("PurchaseQueuePage — C1-bis: perda de permissão não desmonta mutação pendente", () => {
  function installQueueApi() {
    vi.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (url === "/imported-purchases/overview")
        return {
          data: {
            totalOrders: 0,
            totalItems: 0,
            unassigned: 0,
            partiallyAssigned: 0,
            fullyAssigned: 0,
            materialized: 0,
            pending: 0,
            conflicts: 0,
            mappingsPending: 0,
            byProvider: {},
            allowedActions: []
          }
        };
      if (url === "/imported-purchases")
        return { data: { items: listItems, page: 1, limit: 20, total: 1 } };
      if (url === "/products") return { data: { items: products } };
      throw new Error(`GET inesperado: ${url}`);
    });
  }

  it("perda de COMPRAS_IMPORTADAS_VISUALIZAR durante compra pendente preserva o drawer até a mutação terminar", async () => {
    installQueueApi();
    let resolvePost!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePost = resolve;
    });
    const post = vi.spyOn(api, "post").mockReturnValue(pending as never);
    renderWithProviders(<PurchaseQueuePage />, { permissions: permissionsWithMerchant });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+ Nova compra" }));
    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-PERM");
    await user.type(screen.getByLabelText("Item"), "Item perm");
    await user.click(screen.getByRole("button", { name: "Criar compra manual" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    useAuthStore.setState({ permissions: [] });

    // dados/ações globais somem imediatamente...
    await waitFor(() => expect(screen.queryByText("Compras")).toBeNull());
    // ...mas a operação em voo continua montada e intacta
    expect((screen.getByLabelText("Referência") as HTMLInputElement).value).toBe(
      "MANUAL-PERM"
    );
    expect(screen.getByRole("button", { name: /Salvando/ })).toBeTruthy();

    resolvePost({ data: { id: "purchase-perm-1" } });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Compra manual criada.")).toBeTruthy();

    // só depois de concluída a mutação o drawer efetivamente some
    await waitFor(() => expect(screen.queryByLabelText("Referência")).toBeNull());
  });

  it("perda de COMPRAS_IMPORTADAS_IMPORTAR com drawer aberto impede nova submissão sem fechar o drawer", async () => {
    installQueueApi();
    const post = vi.spyOn(api, "post");
    renderWithProviders(<PurchaseQueuePage />, { permissions: permissionsWithMerchant });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+ Nova compra" }));
    await user.click(screen.getByRole("button", { name: "Manual" }));
    await selectMuiOption("Merchant", "Merchant Árvore · AMAZON");
    await selectMuiOption("Produto", "301 — Produto Dronz");
    await user.type(screen.getByLabelText("Referência"), "MANUAL-NOIMPORT");
    await user.type(screen.getByLabelText("Item"), "Item sem permissão");

    useAuthStore.setState({
      permissions: permissionsWithMerchant.filter((p) => p !== "COMPRAS_IMPORTADAS_IMPORTAR")
    });

    // VISUALIZAR continua — a página e o drawer seguem visíveis, só a
    // submissão fica bloqueada
    expect(screen.getByText("Compras")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Criar compra manual" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(post).not.toHaveBeenCalled();
  });
});
