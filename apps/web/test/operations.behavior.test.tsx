import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { OperationsPage } from "../src/pages/OperationsPage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const overview = { lojaId: "store-dronz", totals: { miamiPending: 1, paraguayPending: 1, brazilPending: 1, receivingPending: 1, definitivePending: 1 }, allowedActions: [] };
const empty = { data: [] };
const miami = {
  id: "item-1", quantidade: 3, quantidadeRecebidaMiami: 1, quantidadePendente: 2, alerta24h: true,
  produto: { id: "product-1", codigo: 101, nome: "Produto Miami", peso: "1" },
  pedido: { id: "order-1", numeroPedido: "ORDER-1", status: "CONFIRMED" },
  recebimentosMiami: [], allowedActions: ["CONFIRM_MIAMI"], blockedReasons: []
};
const paraguay = {
  id: "bag-1", codigo: "BAG-1", viagemId: "trip-1", rotaCodigo: "MIAMI_PARAGUAI_BRASIL",
  applicability: "REQUIRED", status: "PENDING", checkpoint: null,
  allowedActions: ["CONFIRM_PARAGUAY"], blockedReasons: []
};
const brazil = { ...paraguay, status: "BLOCKED", applicability: undefined, allowedActions: [], blockedReasons: [{ code: "CHECKPOINT_REQUIRED", message: "CHECKPOINT_REQUIRED" }] };
const receiving = { id: "bag-1", codigo: "BAG-1", viagemId: "trip-1", expectedItems: 1, receiving: null, allowedActions: ["OPEN_RECEIVING"], blockedReasons: [] };
const definitive = { id: "receipt-1", viagemId: "trip-1", malaId: "bag-1", status: "COMPLETED", entryId: null, impactQuantity: 2, items: [], allowedActions: ["POST_DEFINITIVE_ENTRY"], blockedReasons: [] };

function installGetMock(overrides: Partial<Record<string, object>> = {}) {
  vi.mocked(api.get).mockImplementation(async (url) => {
    const value = overrides[String(url)];
    if (value) return { data: value };
    if (url === "/operations/overview") return { data: overview };
    if (url === "/operations/miami/candidates") return { data: [miami] };
    if (url === "/operations/paraguay/candidates") return { data: [paraguay] };
    if (url === "/operations/brazil/candidates") return { data: [brazil] };
    if (url === "/operations/receiving/candidates") return { data: [receiving] };
    if (url === "/operations/definitive-entry/candidates") return { data: [definitive] };
    if (url === "/operations/miami/items/item-1") return { data: { ...miami, history: { items: [], nextCursor: null } } };
    return empty;
  });
}

beforeEach(() => {
  vi.spyOn(api, "get");
  vi.spyOn(api, "post").mockResolvedValue({ data: { id: "result" } });
});

describe("UI-3C operacional", () => {
  it("exibe loading, dados Miami, progresso e histórico sem recalcular o read model", async () => {
    let resolve!: (value: { data: object }) => void;
    vi.mocked(api.get).mockImplementation((url) => url === "/operations/overview"
      ? Promise.resolve({ data: overview })
      : new Promise((done) => { resolve = done; }));
    renderWithProviders(<OperationsPage />);
    expect(screen.getByLabelText("Carregando operação")).toBeTruthy();
    resolve({ data: [miami] });
    expect(await screen.findByText("Produto Miami")).toBeTruthy();
    installGetMock();
    await userEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    expect(await screen.findByText(/Progresso e alerta são fornecidos pela API/)).toBeTruthy();
    expect(screen.getByText("Nenhum evento registrado.")).toBeTruthy();
  });

  it("exibe erro, retry e vazio", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: overview })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(empty);
    renderWithProviders(<OperationsPage />);
    expect(await screen.findByText("Não foi possível carregar esta etapa.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Nenhum registro disponível nesta etapa.")).toBeTruthy();
  });

  it("confirma Miami somente quando allowedActions autoriza e envia tenant correto", async () => {
    installGetMock();
    renderWithProviders(<OperationsPage />);
    await screen.findByText("Produto Miami");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar em Miami" }));
    fireEvent.change(screen.getByLabelText("Quantidade recebida"), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar", exact: true }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe("/logistics/miami-confirmations");
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(expect.objectContaining({ pedidoCompraItemId: "item-1", quantidadeRecebida: 2 }));
    expect(vi.mocked(api.post).mock.calls[0][2]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ "x-store-id": "store-dronz", Authorization: "Bearer access-test" }) }));
  });

  it("reflete NOT_APPLICABLE, bloqueios e ausência de ação exatamente como a API", async () => {
    installGetMock({ "/operations/paraguay/candidates": [{ ...paraguay, applicability: "NOT_APPLICABLE", status: "NOT_APPLICABLE", allowedActions: [], blockedReasons: [{ code: "CHECKPOINT_NOT_APPLICABLE", message: "CHECKPOINT_NOT_APPLICABLE" }] }] });
    renderWithProviders(<OperationsPage />);
    await userEvent.click(screen.getByRole("tab", { name: /Paraguai/ }));
    expect((await screen.findAllByText(/NOT_APPLICABLE/)).length).toBeGreaterThan(0);
    expect(screen.getByText("CHECKPOINT_NOT_APPLICABLE")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar Paraguai" })).toBeNull();
  });

  it("percorre Brasil, Recebimento e Entrada definitiva usando os contratos do backend", async () => {
    installGetMock();
    renderWithProviders(<OperationsPage />);
    await userEvent.click(screen.getByRole("tab", { name: /Brasil/ }));
    expect(await screen.findByText("CHECKPOINT_REQUIRED")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Recebimento/ }));
    expect(await screen.findByRole("button", { name: "Abrir recebimento" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Entrada definitiva/ }));
    expect(await screen.findByText("Impacto informado pela API: 2 unidade(s)")).toBeTruthy();
  });

  it.each([
    ["Paraguai", "/logistics/checkpoint-paraguai", "Confirmar Paraguai", paraguay],
    ["Brasil", "/logistics/checkpoint-brasil", "Confirmar Brasil", { ...paraguay, allowedActions: ["CONFIRM_BRAZIL"], applicability: undefined }]
  ])("confirma checkpoint %s somente pela ação liberada", async (tab, url, button, candidate) => {
    installGetMock({ [`/operations/${tab === "Paraguai" ? "paraguay" : "brazil"}/candidates`]: [candidate] });
    renderWithProviders(<OperationsPage />);
    await userEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
    await userEvent.click(await screen.findByRole("button", { name: button }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar", exact: true }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe(url);
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(expect.objectContaining({ viagemId: "trip-1", malaId: "bag-1" }));
  });

  it("não oferece correção por permissão local quando allowedActions não autoriza", async () => {
    const receivingDetail = {
      id: "receipt-1", viagemId: "trip-1", malaId: "bag-1", status: "IN_PROGRESS",
      itens: [{ id: "receipt-item-1", quantidadeEsperada: 2, quantidadeRecebida: 1, quantidadeRejeitada: 0, quantidadeJaIncorporada: 0, tipoDivergencia: "FALTA", divergenciaResolvida: false, observacoes: "Faltou uma", produto: { id: "product-1", codigo: 101, nome: "Produto recebido" } }],
      progress: { total: 1, completed: 0, pending: 1, divergent: 1 }, allowedActions: ["CONFIRM_RECEIVING_ITEM"], blockedReasons: [],
      history: { items: [{ id: "audit-1", action: "CONFIRM_ITEM", entity: "Recebimento", entityId: "receipt-1", reason: "Conferência", beforeData: null, afterData: { status: "IN_PROGRESS" }, createdAt: "2026-07-12T12:00:00.000Z", usuarioId: "user-1" }], nextCursor: null }
    };
    installGetMock({
      "/operations/receiving/candidates": [{ ...receiving, receiving: { id: "receipt-1", status: "IN_PROGRESS" }, allowedActions: [] }],
      "/operations/receiving/receipt-1": receivingDetail
    });
    renderWithProviders(<OperationsPage />);
    await userEvent.click(screen.getByRole("tab", { name: /Recebimento/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    expect(await screen.findByText(/Progresso da API: 0\/1/)).toBeTruthy();
    expect(screen.getByText("CONFIRM_ITEM")).toBeTruthy();
    expect(useAuthStore.getState().permissions).toContain("CHECKPOINT_CORRIGIR");
    expect(screen.queryByRole("button", { name: "Corrigir" })).toBeNull();
    expect(screen.queryByText("Corrigir item")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("executa a ação oficial do detalhe com idempotência e invalidação tenantada", async () => {
    const receivingDetail = {
      id: "receipt-1", viagemId: "trip-1", malaId: "bag-1", status: "IN_PROGRESS",
      itens: [{ id: "receipt-item-1", quantidadeEsperada: 2, quantidadeRecebida: 0, quantidadeRejeitada: 0, quantidadeJaIncorporada: 0, tipoDivergencia: "CORRETO", divergenciaResolvida: true, observacoes: null, produto: { id: "product-1", codigo: 101, nome: "Produto recebido" } }],
      progress: { total: 1, completed: 0, pending: 1, divergent: 0 }, allowedActions: ["CONFIRM_RECEIVING_ITEM"], blockedReasons: [], history: { items: [], nextCursor: null }
    };
    installGetMock({ "/operations/receiving/candidates": [{ ...receiving, receiving: { id: "receipt-1", status: "IN_PROGRESS" }, allowedActions: [] }], "/operations/receiving/receipt-1": receivingDetail });
    const { queryClient } = renderWithProviders(<OperationsPage />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.click(screen.getByRole("tab", { name: /Recebimento/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    fireEvent.change(screen.getByLabelText("Quantidade recebida"), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Confirmar", exact: true }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe("/receiving/receipt-1/items/receipt-item-1/confirm");
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual(expect.objectContaining({ quantidadeRecebida: 2, tipoDivergencia: "CORRETO" }));
    expect(vi.mocked(api.post).mock.calls[0][2]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ "idempotency-key": expect.any(String), "x-store-id": "store-dronz" }) }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operations", "store-dronz"] }));
  });

  it("fecha ação aberta quando o refetch remove allowedActions", async () => {
    const baseDetail = {
      id: "receipt-1", viagemId: "trip-1", malaId: "bag-1", status: "IN_PROGRESS",
      itens: [{ id: "receipt-item-1", quantidadeEsperada: 1, quantidadeRecebida: 0, quantidadeRejeitada: 0, quantidadeJaIncorporada: 0, tipoDivergencia: "CORRETO", divergenciaResolvida: true, observacoes: null, produto: { id: "product-1", codigo: 101, nome: "Produto recebido" } }],
      progress: { total: 1, completed: 0, pending: 1, divergent: 0 }, blockedReasons: [], history: { items: [], nextCursor: null }
    };
    let detailCalls = 0;
    installGetMock({ "/operations/receiving/candidates": [{ ...receiving, receiving: { id: "receipt-1", status: "IN_PROGRESS" }, allowedActions: [] }] });
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === "/operations/overview") return { data: overview };
      if (url === "/operations/receiving/candidates") return { data: [{ ...receiving, receiving: { id: "receipt-1", status: "IN_PROGRESS" }, allowedActions: [] }] };
      if (url === "/operations/receiving/receipt-1") return { data: { ...baseDetail, allowedActions: detailCalls++ === 0 ? ["CONFIRM_RECEIVING_ITEM"] : [], blockedReasons: detailCalls > 1 ? [{ code: "RECEIVING_ALREADY_COMPLETE", message: "RECEIVING_ALREADY_COMPLETE" }] : [] } };
      return empty;
    });
    const { queryClient } = renderWithProviders(<OperationsPage />);
    await userEvent.click(screen.getByRole("tab", { name: /Recebimento/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Conferir" }));
    expect(screen.getByText("Confirmar item")).toBeTruthy();
    await queryClient.refetchQueries({ queryKey: ["operations", "store-dronz", "receiving", "detail", "receipt-1"] });
    await waitFor(() => expect(screen.queryByText("Confirmar item")).toBeNull());
    expect(screen.queryByRole("button", { name: "Conferir" })).toBeNull();
    expect(await screen.findByText("RECEIVING_ALREADY_COMPLETE")).toBeTruthy();
  });

  it("isola query e header após troca de loja sem mostrar dados stale", async () => {
    installGetMock();
    renderWithProviders(<OperationsPage />);
    await screen.findByText("Produto Miami");
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === "/operations/overview") return { data: { ...overview, lojaId: "store-gooder" } };
      if (url === "/operations/miami/candidates") {
        expect(config?.headers?.["x-store-id"]).toBe("store-gooder");
        return { data: [{ ...miami, id: "item-gooder", produto: { ...miami.produto, nome: "Produto Gooder" } }] };
      }
      return empty;
    });
    useAuthStore.getState().setActiveStoreId(testStores[1].id);
    expect(await screen.findByText("Produto Gooder")).toBeTruthy();
    expect(screen.queryByText("Produto Miami")).toBeNull();
  });

  it("remove ação da loja anterior quando a nova loja não a autoriza", async () => {
    installGetMock();
    renderWithProviders(<OperationsPage />);
    expect(await screen.findByRole("button", { name: "Confirmar em Miami" })).toBeTruthy();
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === "/operations/overview") return { data: { ...overview, lojaId: "store-gooder" } };
      if (url === "/operations/miami/candidates") {
        expect(config?.headers?.["x-store-id"]).toBe("store-gooder");
        return { data: [{ ...miami, id: "item-gooder", allowedActions: [], blockedReasons: [{ code: "INSUFFICIENT_PERMISSION", message: "Ação indisponível" }] }] };
      }
      return empty;
    });
    useAuthStore.getState().setActiveStoreId(testStores[1].id);
    expect(await screen.findByText("Ação indisponível")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar em Miami" })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
