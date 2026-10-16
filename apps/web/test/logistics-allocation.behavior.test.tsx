import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { LogisticsPage } from "../src/pages/LogisticsPage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const bag = {
  id: "bag-a", codigo: "MALA-A", status: "PLANNING", limitePesoKg: "23",
  volumes: [{ id: "volume-a", codigo: "VOLUME-A" }], alocacoes: []
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
