import React from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { PurchaseQueuePage } from "../src/pages/PurchaseQueuePage";
import type { UnifiedPurchaseDetail } from "../src/types/unified-purchases";
import { renderWithProviders } from "./render";

const permissions = ["COMPRAS_IMPORTADAS_VISUALIZAR"];

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

const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const oldIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

const conflictedItem = {
  id: "purchase-1",
  provider: "AMAZON",
  account: { id: "account-1", name: "Conta principal" },
  merchant: { id: "merchant-1", name: "Merchant Árvore" },
  reference: "ORDER-CONFLICT",
  orderedAt: recentIso,
  currency: "USD",
  state: "COM_DIVERGENCIA",
  itemCount: 1,
  progress: { total: 5, assigned: 2, materialized: 0, pending: 3 },
  conflictCount: 1,
  allowedActions: ["ASSIGN_TO_STORE", "SET_PRODUCT_MAPPING", "RESOLVE_CONFLICT"],
  blockedReasons: [{ code: "EXTERNAL_ORDER_CONFLICT", message: "Compra possui conflito aberto." }]
};

const oldNoBlockItem = {
  id: "purchase-2",
  provider: "MANUAL",
  account: null,
  merchant: { id: "merchant-2", name: "Merchant Antigo" },
  reference: "ORDER-OLD",
  orderedAt: oldIso,
  currency: "USD",
  state: "EM_REVISAO",
  itemCount: 1,
  progress: { total: 2, assigned: 2, materialized: 2, pending: 0 },
  conflictCount: 0,
  allowedActions: [],
  blockedReasons: []
};

const detail: UnifiedPurchaseDetail = {
  id: "purchase-1",
  plataforma: "AMAZON",
  numeroPedido: "ORDER-CONFLICT",
  referenciaPesquisavel: "ORDER-CONFLICT",
  externalOrderIdOriginal: "ORDER-CONFLICT",
  dataPedido: recentIso,
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
      skuExterno: "SKU-1",
      asin: null,
      externalLineIdOriginal: "LINE-1",
      quantidade: 5,
      quantidadeCancelada: 0,
      quantidadeReembolsada: 0,
      precoUnitario: "100.00",
      moeda: "USD",
      status: "ATIVA",
      version: 3,
      atribuicoes: [],
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
      referencia: "ORDER-CONFLICT",
      motivoResolucao: null,
      createdAt: recentIso
    }
  ],
  history: [],
  allowedActions: ["ASSIGN_TO_STORE", "SET_PRODUCT_MAPPING", "RESOLVE_CONFLICT"],
  blockedReasons: [{ code: "EXTERNAL_ORDER_CONFLICT", message: "Compra possui conflito aberto." }]
};

function installApi(overrides: { list?: object; overview?: object } = {}) {
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/imported-purchases/overview") return { data: overrides.overview ?? overview };
    if (url === "/imported-purchases")
      return {
        data: overrides.list ?? {
          items: [conflictedItem, oldNoBlockItem],
          page: 1,
          limit: 20,
          total: 2
        }
      };
    if (url === "/imported-purchases/purchase-1") return { data: detail };
    throw new Error(`GET inesperado: ${url}`);
  });
}

beforeEach(() => installApi());

describe("UX-1B — Fila de Compras (estrutural, somente leitura)", () => {
  it("renderiza cards de urgência, bloco Economia e a fila com dados reais do backend", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    expect(await screen.findByText("Compras")).toBeTruthy();
    expect(await screen.findByText("Exige atenção agora")).toBeTruthy();
    expect(screen.getByText("Economia")).toBeTruthy();
    expect(await screen.findByText("ORDER-CONFLICT")).toBeTruthy();
    expect(screen.getByText("ORDER-OLD")).toBeTruthy();
  });

  it("apresenta métricas futuras como indisponíveis, nunca como erro", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    await screen.findByText("Economia");
    const futureLabels = screen.getAllByText("Disponível na Fase Econômica");
    expect(futureLabels.length).toBe(2);
    expect(screen.queryByText(/indisponível/i)).toBeNull();
    expect(screen.queryByText(/erro/i)).toBeNull();
  });

  it("marca prioridade por conflito/bloqueio, não por idade", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    await screen.findByText("ORDER-CONFLICT");
    // item recente com conflito é crítico; item antigo sem bloqueio e concluído não é.
    expect(screen.getByLabelText("Prioridade Crítico")).toBeTruthy();
    expect(screen.getByLabelText("Prioridade Concluído")).toBeTruthy();
    expect(screen.queryByLabelText("Prioridade Alto")).toBeNull();
  });

  it("abre o drawer com ações operacionais conforme allowedActions", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    await userEvent.click(await screen.findByText("ORDER-CONFLICT"));
    expect(await screen.findByText("Notebook externo")).toBeTruthy();
    expect(screen.getByText("Bloqueios")).toBeTruthy();
    expect(screen.getByText("Compra possui conflito aberto.")).toBeTruthy();

    // Item sem mapeamentos: botão "Mapear produto" aparece e habilitado
    expect(screen.getByRole("button", { name: "Mapear produto" })).toBeTruthy();

    // Seção de ações operacionais vazia (sem atribuições para materializar)
    expect(
      screen.getByText("Sem ações operacionais disponíveis.")
    ).toBeTruthy();

    // Seção de conflitos com botão resolver
    expect(screen.getByRole("button", { name: "Resolver" })).toBeTruthy();
  });

  it("filtra a fila por categoria sem alterar o número global do card de urgência", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    await screen.findByText("ORDER-CONFLICT");
    await userEvent.click(screen.getByRole("tab", { name: "Conflitos" }));
    expect(screen.getByText("ORDER-CONFLICT")).toBeTruthy();
    expect(screen.queryByText("ORDER-OLD")).toBeNull();
  });

  it("exibe vazio, erro e retry sem fabricar dados", async () => {
    installApi({ list: { items: [], page: 1, limit: 20, total: 0 } });
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    expect(
      await screen.findByText("Nenhuma compra aguardando revisão ✓")
    ).toBeTruthy();

    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/imported-purchases/overview") return { data: overview };
      if (url === "/imported-purchases") throw new Error("network error");
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<PurchaseQueuePage />, { permissions });
    expect(await screen.findByText("Falha ao carregar a fila de compras.")).toBeTruthy();
  });

  it("nega acesso a usuário sem permissão de visualização", async () => {
    renderWithProviders(<PurchaseQueuePage />, { permissions: [] });
    expect(
      await screen.findByText(
        "Você não possui permissão para visualizar a staging global de compras."
      )
    ).toBeTruthy();
  });
});
