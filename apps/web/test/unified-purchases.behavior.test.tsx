import React from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { UnifiedPurchasesPage } from "../src/pages/UnifiedPurchasesPage";
import { useAuthStore } from "../src/stores/auth";
import type { UnifiedPurchaseDetail } from "../src/types/unified-purchases";
import { renderWithProviders } from "./render";

const permissions = [
  "COMPRAS_IMPORTADAS_VISUALIZAR",
  "COMPRAS_IMPORTADAS_IMPORTAR",
  "COMPRAS_IMPORTADAS_REVISAR",
  "COMPRAS_IMPORTADAS_ATRIBUIR",
  "MAPPING_PRODUTO_GERENCIAR",
  "MAPPING_FORNECEDOR_GERENCIAR",
  "COMPRAS_IMPORTADAS_MATERIALIZAR",
  "CONTA_EXTERNA_GERENCIAR"
];

const overview = {
  totalOrders: 1,
  totalItems: 1,
  unassigned: 0,
  partiallyAssigned: 1,
  fullyAssigned: 0,
  materialized: 0,
  pending: 3,
  conflicts: 1,
  mappingsPending: 1,
  byProvider: { AMAZON: 1 },
  allowedActions: ["CREATE_MANUAL_PURCHASE"]
};
const listItem = {
  id: "purchase-1",
  provider: "AMAZON",
  account: { id: "account-1", name: "Conta principal" },
  merchant: { id: "merchant-1", name: "Merchant Árvore" },
  reference: "ORDER-ÁbC-1",
  orderedAt: "2026-07-13T12:00:00.000Z",
  currency: "USD",
  state: "COM_DIVERGENCIA",
  itemCount: 1,
  progress: { total: 5, assigned: 2, materialized: 0, pending: 3 },
  conflictCount: 1,
  allowedActions: [
    "ASSIGN_TO_STORE",
    "SET_PRODUCT_MAPPING",
    "SET_SUPPLIER_MAPPING",
    "RESOLVE_CONFLICT"
  ],
  blockedReasons: [
    {
      code: "EXTERNAL_ORDER_CONFLICT",
      message: "Compra possui conflito aberto."
    }
  ]
};
const detail: UnifiedPurchaseDetail = {
  id: "purchase-1",
  plataforma: "AMAZON",
  numeroPedido: "ORDER-ÁbC-1",
  referenciaPesquisavel: "ORDER-ÁbC-1",
  externalOrderIdOriginal: "ORDER-ÁbC-1",
  dataPedido: "2026-07-13T12:00:00.000Z",
  moeda: "USD",
  estado: "COM_DIVERGENCIA",
  version: 2,
  contaExterna: { id: "account-1", nomeExibicao: "Conta principal" },
  merchantExterno: { id: "merchant-1", nomeOriginal: "Merchant Árvore" },
  merchantExternoId: "merchant-1",
  itens: [
    {
      id: "item-1",
      titulo: "Notebook externo",
      variacao: null,
      skuExterno: "SKU-Á",
      asin: "ASIN-1",
      externalLineIdOriginal: "LINE-1",
      quantidade: 5,
      quantidadeCancelada: 0,
      quantidadeReembolsada: 0,
      precoUnitario: "100.00",
      moeda: "USD",
      status: "ATIVA",
      version: 3,
      atribuicoes: [
        {
          id: "assignment-1",
          lojaId: "store-dronz",
          quantidade: 2,
          quantidadeMaterializada: 0,
          version: 2,
          loja: { id: "store-dronz", nome: "Dronz", slug: "dronz" }
        }
      ],
      mapeamentos: [],
      itensMaterializados: []
    }
  ],
  materializacoes: [],
  conflitos: [
    {
      id: "conflict-1",
      tipo: "PAYLOAD_MISMATCH",
      status: "ABERTO",
      referencia: "ORDER-ÁbC-1",
      motivoResolucao: null,
      createdAt: "2026-07-13T12:00:00.000Z"
    }
  ],
  history: [
    {
      id: "history-1",
      action: "IMPORT_EXTERNAL_PURCHASE",
      entity: "CompraImportada",
      entityId: "purchase-1",
      usuarioId: "user-test",
      lojaId: null,
      reason: null,
      createdAt: "2026-07-13T12:00:00.000Z"
    }
  ],
  allowedActions: [
    "ASSIGN_TO_STORE",
    "REMOVE_ASSIGNMENT",
    "SET_PRODUCT_MAPPING",
    "SET_SUPPLIER_MAPPING",
    "MATERIALIZE_STORE_ALLOCATION",
    "RESOLVE_CONFLICT",
    "CREATE_MANUAL_PURCHASE"
  ],
  blockedReasons: [
    {
      code: "EXTERNAL_ORDER_CONFLICT",
      message: "Compra possui conflito aberto."
    }
  ]
};

function installApi(
  overrides: {
    detail?: UnifiedPurchaseDetail;
    list?: object;
    overview?: object;
  } = {}
) {
  vi.spyOn(api, "get").mockImplementation(async (url, config) => {
    if (url === "/imported-purchases/overview")
      return { data: overrides.overview ?? overview };
    if (url === "/imported-purchases")
      return {
        data: overrides.list ?? {
          items: [listItem],
          page: 1,
          limit: 10,
          total: 1
        }
      };
    if (url === "/imported-purchases/purchase-1")
      return { data: overrides.detail ?? detail };
    if (url === "/products") {
      return {
        data: {
          items: [
            {
              id: `product-${config?.headers?.["x-store-id"]}`,
              codigo: 301,
              nome: `Produto ${config?.headers?.["x-store-id"]}`
            }
          ]
        }
      };
    }
    if (url === "/suppliers")
      return {
        data: {
          items: [
            {
              id: `supplier-${config?.headers?.["x-store-id"]}`,
              nome: "Fornecedor interno",
              ativo: true
            }
          ]
        }
      };
    throw new Error(`GET inesperado: ${url}`);
  });
  vi.spyOn(api, "post").mockResolvedValue({ data: { id: "created-1" } });
  vi.spyOn(api, "put").mockResolvedValue({ data: { id: "updated-1" } });
  vi.spyOn(api, "delete").mockResolvedValue({ data: { id: "deleted-1" } });
}

async function openDetail() {
  await screen.findByText("ORDER-ÁbC-1");
  await userEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
  await screen.findByText("Notebook externo");
}

async function selectMuiOption(label: string, option: string, scope = screen) {
  await userEvent.click(scope.getByLabelText(label));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => installApi());

describe("Compras Unificadas", () => {
  it("renderiza overview, staging global, progresso e bloqueios produzidos pelo backend", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    expect(await screen.findByText("Compras Unificadas")).toBeTruthy();
    expect(await screen.findByText("Saldo pendente")).toBeTruthy();
    expect(
      await screen.findByText(
        /Total 5 · atribuído 2 · materializado 0 · pendente 3/
      )
    ).toBeTruthy();
    expect(screen.getByText(/Compra possui conflito aberto/)).toBeTruthy();
  });

  it("envia apenas filtros suportados e troca entre Todas e loja autorizada", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    await selectMuiOption("Plataforma", "AMAZON");
    await userEvent.click(screen.getByRole("tab", { name: "Por loja" }));
    await waitFor(() => {
      const call = vi
        .mocked(api.get)
        .mock.calls.filter(([url]) => url === "/imported-purchases")
        .at(-1);
      expect(call?.[1]?.params).toEqual(
        expect.objectContaining({
          plataforma: "AMAZON",
          lojaId: "store-dronz",
          page: 1,
          limit: 10
        })
      );
    });
  });

  it("exibe vazio, erro e retry sem fabricar dados", async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === "/imported-purchases/overview") return { data: overview };
      if (url === "/imported-purchases") throw new Error("offline");
      throw new Error("inesperado");
    });
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    expect(
      await screen.findByText("Não foi possível carregar as compras.")
    ).toBeTruthy();
    vi.mocked(api.get).mockImplementation(async (url) =>
      url === "/imported-purchases/overview"
        ? { data: overview }
        : { data: { items: [], page: 1, limit: 10, total: 0 } }
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" })
    );
    expect(
      await screen.findByText("Nenhuma compra corresponde aos filtros.")
    ).toBeTruthy();
  });

  it("não oferece ação contextual quando allowedActions está ausente, mesmo com permissões locais", async () => {
    installApi({ detail: { ...detail, allowedActions: [] } });
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await openDetail();
    expect(
      screen.queryByRole("button", { name: "Atribuir à loja" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Materializar Dronz/ })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolver conflito" })
    ).toBeNull();
  });

  it("atribui quantidade usando versão, tenant e idempotência", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await openDetail();
    fireEvent.change(screen.getByLabelText("Quantidade atribuída"), {
      target: { value: "4" }
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Atribuir à loja" })
    );
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0]).toEqual([
      "/imported-purchases/items/item-1/assignments/store-dronz",
      { quantidade: 4, expectedVersion: 3, motivo: "Ajuste operacional" },
      {
        headers: expect.objectContaining({
          "x-store-id": "store-dronz",
          "idempotency-key": expect.any(String),
          Authorization: "Bearer access-test"
        })
      }
    ]);
  });

  it("troca de loja carrega produtos tenantados e não reutiliza ID anterior", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await openDetail();
    const itemCard = screen
      .getByText("Notebook externo")
      .closest(".MuiCard-root");
    expect(itemCard).toBeTruthy();
    const scope = within(itemCard as HTMLElement);
    await selectMuiOption("Loja da ação", "Gooder", scope);
    await selectMuiOption(
      "Produto interno",
      "301 — Produto store-gooder",
      scope
    );
    await userEvent.click(
      scope.getByRole("button", { name: "Mapear produto" })
    );
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/imported-purchases/items/item-1/product-mappings/store-gooder",
        { produtoId: "product-store-gooder", expectedVersion: undefined },
        { headers: expect.objectContaining({ "x-store-id": "store-gooder" }) }
      )
    );
  });

  it("materializa por loja com versão da compra e não cria regra operacional local", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await openDetail();
    await userEvent.click(
      screen.getByRole("button", { name: "Materializar Dronz" })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/imported-purchases/purchase-1/materializations/store-dronz",
        { expectedPurchaseVersion: 2 },
        {
          headers: expect.objectContaining({
            "x-store-id": "store-dronz",
            "idempotency-key": expect.any(String)
          })
        }
      )
    );
  });

  it("resolve conflito somente quando a ação oficial está presente", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await openDetail();
    await userEvent.click(
      screen.getByRole("button", { name: "Resolver conflito" })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/imported-purchases/conflicts/conflict-1/resolve",
        { motivo: "Conflito revisado manualmente" },
        {
          headers: expect.objectContaining({
            "idempotency-key": expect.any(String)
          })
        }
      )
    );
  });

  it("cadastra conta sem inventar endpoint de listagem", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    await userEvent.click(screen.getByRole("button", { name: "Nova conta" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Identificador externo"),
      "account@example.com"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Nome de exibição"),
      "Conta Amazon"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar" })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/imported-purchases/accounts",
        {
          plataforma: "AMAZON",
          identificadorExterno: "account@example.com",
          nomeExibicao: "Conta Amazon",
          origemIntegracao: "API"
        },
        {
          headers: expect.objectContaining({
            "idempotency-key": expect.any(String)
          })
        }
      )
    );
    expect(
      vi
        .mocked(api.get)
        .mock.calls.some(([url]) => url === "/imported-purchases/accounts")
    ).toBe(false);
  });

  it("cadastra merchant preservando sua identidade externa", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Novo merchant" })
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("ID externo (opcional)"),
      "merchant-Á-1"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Nome do merchant"),
      "Loja São João"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar" })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/imported-purchases/merchants",
        {
          plataforma: "AMAZON",
          externalMerchantId: "merchant-Á-1",
          nome: "Loja São João"
        },
        {
          headers: expect.objectContaining({
            "idempotency-key": expect.any(String)
          })
        }
      )
    );
  });

  it("cria compra manual em USD para loja e produto autorizados", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Compra manual" })
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("ID do merchant"),
      "clymerchant0000000000001"
    );
    await selectMuiOption(
      "Produto",
      "301 — Produto store-dronz",
      within(dialog)
    );
    await userEvent.type(
      within(dialog).getByLabelText("Referência"),
      "MANUAL-001"
    );
    await userEvent.type(within(dialog).getByLabelText("Item"), "Item manual");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar" })
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/imported-purchases/manual",
        expect.objectContaining({
          referencia: "MANUAL-001",
          lojaId: "store-dronz",
          merchantExternoId: "clymerchant0000000000001",
          moeda: "USD",
          itens: [
            expect.objectContaining({
              produtoId: "product-store-dronz",
              moeda: "USD"
            })
          ]
        }),
        {
          headers: expect.objectContaining({
            "x-store-id": "store-dronz",
            "idempotency-key": expect.any(String)
          })
        }
      )
    );
  });

  it("preserva Unicode, caixa, plataforma e conta ao registrar compra externa", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Registrar externa" })
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("ID da conta"),
      "clyaccount000000000000001"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Número externo"),
      "ÁbC-ç-001"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Referência"),
      "Pedido Ção"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Item"),
      "Câmera Óptica"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar" })
    );
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls.at(-1)?.[1];
    expect(payload).toEqual(
      expect.objectContaining({
        plataforma: "AMAZON",
        contaExternaId: "clyaccount000000000000001",
        externalOrderId: "ÁbC-ç-001",
        referencia: "Pedido Ção"
      })
    );
    expect(payload).toEqual(
      expect.objectContaining({
        itens: [expect.objectContaining({ titulo: "Câmera Óptica" })]
      })
    );
  });

  it("bloqueia a página sem permissão global de leitura", () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions: [] });
    expect(
      screen.getByText(
        "Você não possui permissão para visualizar a staging global."
      )
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("remove dados globais da tela quando a identidade perde permissão", async () => {
    renderWithProviders(<UnifiedPurchasesPage />, { permissions });
    await screen.findByText("ORDER-ÁbC-1");
    useAuthStore.setState({ permissions: [] });
    expect(
      await screen.findByText(
        "Você não possui permissão para visualizar a staging global."
      )
    ).toBeTruthy();
    expect(screen.queryByText("ORDER-ÁbC-1")).toBeNull();
  });
});
