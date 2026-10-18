import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { FinancePage } from "../src/pages/FinancePage";
import { PurchaseOrdersPage } from "../src/pages/PurchaseOrdersPage";
import { renderWithProviders, testStores } from "./render";

const order = (id: string) => ({
  id, numeroPedido: id, status: "DRAFT", allowedStatusTransitions: [],
  subtotal: "10", total: "10", fornecedor: { id: "supplier-1", nome: "Fornecedor", ativo: true }
});

describe("acesso a pedidos antigos", () => {
  it("avança para a segunda página sem reutilizar os pedidos da primeira", async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, "get").mockImplementation(async (url, config) => ({
      data: url === "/purchase-orders"
        ? { items: config?.params?.page === 2 ? [order("OLD-ORDER")] : Array.from({ length: 20 }, (_, index) => order(`PAGE-${index}`)) }
        : url === "/positions" || String(url).endsWith("/trackings") ? [] : { items: [] }
    }));
    renderWithProviders(<PurchaseOrdersPage />);
    expect(await screen.findByText("PAGE-0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("OLD-ORDER")).toBeTruthy();
    expect(screen.queryByText("PAGE-0")).toBeNull();
    expect(get).toHaveBeenCalledWith("/purchase-orders", expect.objectContaining({
      headers: expect.objectContaining({ "x-store-id": testStores[0].id }),
      params: { page: 2, limit: 20 }
    }));
  });

  it("busca por número e permite selecionar um pedido antigo no Financeiro", async () => {
    const user = userEvent.setup();
    const warning = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const get = vi.spyOn(api, "get").mockImplementation(async (url, config) => ({
      data: url === "/purchase-orders"
        ? { items: config?.params?.numero === "OLD-ORDER"
          ? config?.params?.page === 2
            ? [{ ...order("old-id"), numeroPedido: "OLD-ORDER" }]
            : Array.from({ length: 20 }, (_, index) => ({ ...order(`new-${index}`), numeroPedido: `NEW-OLD-ORDER-${index}` }))
          : [] }
        : []
    }));
    renderWithProviders(<FinancePage />);
    await user.type(screen.getByLabelText("Número do pedido"), "OLD-ORDER");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/purchase-orders", expect.objectContaining({
      headers: expect.objectContaining({ "x-store-id": testStores[0].id }),
      params: { numero: "OLD-ORDER", page: 1, limit: 20 }
    })));
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/purchase-orders", expect.objectContaining({
      params: { numero: "OLD-ORDER", page: 2, limit: 20 }
    })));
    await user.click(screen.getByRole("combobox", { name: "Pedido" }));
    await user.click(await screen.findByRole("option", { name: "OLD-ORDER" }));
    expect(screen.getByRole("combobox", { name: "Pedido" }).textContent).toContain("OLD-ORDER");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("combobox", { name: "Pedido" }).textContent).toContain("OLD-ORDER");
    expect(screen.getByText("Página 2")).toBeTruthy();
    await user.clear(screen.getByLabelText("Número do pedido"));
    await user.type(screen.getByLabelText("Número do pedido"), "MISSING");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/purchase-orders", expect.objectContaining({
      params: { numero: "MISSING", page: 1, limit: 20 }
    })));
    expect(screen.getByText("Página 1")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Pedido" }).textContent).not.toContain("OLD-ORDER");
    expect(warning).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
