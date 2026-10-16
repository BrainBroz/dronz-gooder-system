import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { LogisticsPage } from "../src/pages/LogisticsPage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";
import { logisticsQueryKeys } from "../src/queryKeys";

const bag = {
  id: "bag-a", codigo: "MALA-A", status: "PLANNING", limitePesoKg: "23",
  volumes: [{ id: "volume-a", codigo: "VOLUME-A" }], alocacoes: [],
  allowedStatusTransitions: ["CLOSED"]
};
const order = {
  id: "order-a", numeroPedido: "ORD-A",
  itens: [{ id: "item-a", quantidadeRecebidaMiami: 2, produto: { nome: "Produto A" } }]
};
const weight = {
  conteudoKg: "0", taraKg: "0.5", totalKg: "0.5", restanteKg: "22.5", excesso: false
};

function mockReads() {
  return vi.spyOn(api, "get").mockImplementation(async (url, config) => {
    if (url === "/logistics/travelers" || url === "/logistics/trips") return { data: [] };
    if (url === "/logistics/suitcases") return { data: [bag] };
    if (url === "/purchase-orders/search/numero")
      return { data: config?.headers?.["x-store-id"] === testStores[0].id ? [order] : [] };
    if (url === "/logistics/suitcases/bag-a/weight") return { data: weight };
    throw new Error(`GET inesperado: ${url}`);
  });
}

describe("Logística — alocação após Miami", () => {
  it("busca o item, aloca na mala da loja e atualiza o peso", async () => {
    const user = userEvent.setup();
    const get = mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "allocation-a" } });
    renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByRole("button", { name: "Ver peso" }));
    expect(await screen.findByText("Total: 0.50 kg")).toBeTruthy();
    await user.type(screen.getByLabelText("Número do pedido para alocação"), "ORD-A");
    await user.click(screen.getByRole("button", { name: "Buscar pedido" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(
      "/purchase-orders/search/numero",
      expect.objectContaining({
        params: { numero: "ORD-A" },
        headers: expect.objectContaining({ "x-store-id": testStores[0].id })
      })
    ));
    await user.click(screen.getByRole("combobox", { name: "Item recebido" }));
    await user.click(await screen.findByRole("option", { name: /ORD-A · Produto A · Miami: 2/ }));
    await user.click(screen.getByRole("combobox", { name: "Mala para alocação" }));
    await user.click(screen.getByRole("option", { name: "MALA-A — PLANNING" }));
    await user.click(screen.getByRole("combobox", { name: "Volume" }));
    await user.click(screen.getByRole("option", { name: "VOLUME-A" }));
    await user.clear(screen.getByLabelText("Quantidade para alocar"));
    await user.type(screen.getByLabelText("Quantidade para alocar"), "2");
    await user.click(screen.getByRole("button", { name: "Alocar na mala" }));
    expect(await screen.findByText("Item alocado na mala.")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("/logistics/allocations", {
      pedidoCompraItemId: "item-a", malaId: "bag-a", volumeLogisticoId: "volume-a", quantidade: 2
    }, { headers: { Authorization: "Bearer access-test", "x-store-id": testStores[0].id } });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Item recebido" }).textContent).not.toContain("Produto A");
    expect(screen.getByRole("combobox", { name: "Mala para alocação" }).textContent).not.toContain("MALA-A");
    await waitFor(() => expect(get.mock.calls.filter(([url]) => url === "/logistics/suitcases/bag-a/weight")).toHaveLength(2));
  });

  it("adiciona volume com tara explícita e invalida a lista de malas", async () => {
    const user = userEvent.setup();
    const get = mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { id: "volume-b" } });
    renderWithProviders(<LogisticsPage />);
    await screen.findByRole("button", { name: "Ver peso" });
    await user.click(screen.getByRole("combobox", { name: "Mala para volume" }));
    await user.click(screen.getByRole("option", { name: "MALA-A — PLANNING" }));
    await user.type(screen.getByLabelText("Código do volume"), "VOLUME-B");
    await user.clear(screen.getByLabelText("Tara (kg)"));
    await user.type(screen.getByLabelText("Tara (kg)"), "0.8");
    await user.click(screen.getByRole("button", { name: "Adicionar volume" }));
    expect(await screen.findByText("Volume adicionado.")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("/logistics/suitcases/bag-a/volumes", {
      codigo: "VOLUME-B", taraKg: 0.8
    }, { headers: { Authorization: "Bearer access-test", "x-store-id": testStores[0].id } });
    expect(post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(get.mock.calls.filter(([url]) => url === "/logistics/suitcases")).toHaveLength(2));
  });

  it("troca de loja descarta busca e seleção antigas", async () => {
    const user = userEvent.setup();
    const get = mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    await user.type(screen.getByLabelText("Número do pedido para alocação"), "ORD-A");
    await user.click(screen.getByRole("button", { name: "Buscar pedido" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(
      "/purchase-orders/search/numero",
      expect.objectContaining({ params: { numero: "ORD-A" } })
    ));
    await user.click(screen.getByRole("combobox", { name: "Item recebido" }));
    expect(await screen.findByRole("option", { name: /ORD-A · Produto A · Miami: 2/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    useAuthStore.getState().setActiveStoreId(testStores[1].id);
    await waitFor(() => expect((screen.getByLabelText("Número do pedido para alocação") as HTMLInputElement).value).toBe(""));
    expect(screen.queryByText(/Produto A · Miami: 2/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Alocar na mala" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("editar a busca descarta o item antigo antes de consultar outro pedido", async () => {
    const user = userEvent.setup();
    const get = mockReads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    const search = screen.getByLabelText("Número do pedido para alocação");
    await user.type(search, "ORD-A");
    await user.click(screen.getByRole("button", { name: "Buscar pedido" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(
      "/purchase-orders/search/numero", expect.objectContaining({ params: { numero: "ORD-A" } })
    ));
    await user.click(screen.getByRole("combobox", { name: "Item recebido" }));
    await user.click(await screen.findByRole("option", { name: /ORD-A · Produto A/ }));
    await user.clear(search);
    await user.type(search, "OTHER");
    expect(screen.getByRole("combobox", { name: "Item recebido" }).textContent).not.toContain("Produto A");
    await user.click(screen.getByRole("combobox", { name: "Item recebido" }));
    expect(screen.queryByRole("option", { name: /ORD-A · Produto A/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Alocar na mala" }));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Logística — transições informadas pelo backend", () => {
  it("envia a transição da viagem somente após confirmação explícita", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/logistics/travelers") return { data: [] };
      if (url === "/logistics/trips") return { data: [{
        id: "trip-a", origem: "Miami", destino: "Brasil", status: "OPEN_FOR_ALLOCATION",
        allowedStatusTransitions: ["CLOSED_FOR_ALLOCATION"]
      }] };
      if (url === "/logistics/suitcases") return { data: [] };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByRole("button", { name: "Encerrar alocação da viagem" }));
    expect(patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(patch).toHaveBeenCalledWith("/logistics/trips/trip-a/status", {
      status: "CLOSED_FOR_ALLOCATION"
    }, { headers: { Authorization: "Bearer access-test", "x-store-id": testStores[0].id } });
  });

  it("confirma fechamento da mala usando a loja atual e remove a ação após refetch", async () => {
    const user = userEvent.setup();
    let currentBag = { ...bag };
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/logistics/travelers" || url === "/logistics/trips") return { data: [] };
      if (url === "/logistics/suitcases") return { data: [currentBag] };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockImplementation(async () => {
      currentBag = { ...currentBag, status: "CLOSED", allowedStatusTransitions: [] };
      return { data: currentBag };
    });
    renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByRole("button", { name: "Fechar mala" }));
    expect(screen.getByText("Fechar mala: MALA-A?")).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(patch).toHaveBeenCalledWith("/logistics/suitcases/bag-a/status", { status: "CLOSED" }, {
      headers: { Authorization: "Bearer access-test", "x-store-id": testStores[0].id }
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Fechar mala" })).toBeNull());
    expect(await screen.findByText("MALA-A — CLOSED")).toBeTruthy();
    expect(get.mock.calls.filter(([url]) => url === "/logistics/suitcases")).toHaveLength(2);
  });

  it("não cria ação por permissão local quando a API não a oferece", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/logistics/travelers" || url === "/logistics/trips") return { data: [] };
      if (url === "/logistics/suitcases") return {
        data: [{ ...bag, allowedStatusTransitions: [] }]
      };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />, { permissions: ["CHECKPOINT_CORRIGIR"] });
    await screen.findByText("MALA-A — PLANNING");
    expect(screen.queryByRole("button", { name: "Fechar mala" })).toBeNull();
    expect(screen.queryByText("Confirmar etapa física")).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it("troca de loja descarta a transição da viagem anterior", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url, config) => {
      if (url === "/logistics/travelers") return { data: [] };
      if (url === "/logistics/trips") return { data: config?.headers?.["x-store-id"] === testStores[0].id
        ? [{ id: "trip-a", origem: "Miami", destino: "Brasil", status: "OPEN_FOR_ALLOCATION", allowedStatusTransitions: ["CLOSED_FOR_ALLOCATION"] }]
        : [] };
      if (url === "/logistics/suitcases") return { data: [] };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByRole("button", { name: "Encerrar alocação da viagem" }));
    useAuthStore.getState().setActiveStoreId(testStores[1].id);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Encerrar alocação da viagem" })).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it("fecha confirmação aberta quando refetch remove a ação", async () => {
    const user = userEvent.setup();
    let transitions = ["CLOSED"];
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/logistics/travelers" || url === "/logistics/trips") return { data: [] };
      if (url === "/logistics/suitcases") return { data: [{ ...bag, allowedStatusTransitions: transitions }] };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    const { queryClient } = renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByRole("button", { name: "Fechar mala" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();
    transitions = [];
    await queryClient.invalidateQueries({ queryKey: logisticsQueryKeys.suitcases(testStores[0].id) });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull());
    expect(patch).not.toHaveBeenCalled();
  });
});
