import React from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { PurchaseOrdersPage } from "../src/pages/PurchaseOrdersPage";
import { useAuthStore } from "../src/stores/auth";
import { renderWithProviders, testStores } from "./render";

const order = (status: string, allowedStatusTransitions: string[]) => ({
  id: "order-1", numeroPedido: "DEMO-ORDER", status, allowedStatusTransitions,
  subtotal: "50", total: "50", fornecedor: { id: "supplier-1", nome: "Fornecedor", ativo: true }
});

beforeEach(() => {
  vi.spyOn(api, "get").mockImplementation(async (url, config) => ({
    data: url === "/purchase-orders"
      ? { items: config?.headers?.["x-store-id"] === testStores[0].id ? [order("DRAFT", ["PLACED", "CANCELLED"])] : [order("DRAFT", [])] }
      : { items: [] }
  }));
});

describe("Pedidos Operacionais", () => {
  it("oferece apenas transições devolvidas pela API e envia status e loja corretos", async () => {
    const user = userEvent.setup();
    let status = "DRAFT";
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === "/purchase-orders" ? { items: [order(status, status === "DRAFT" ? ["PLACED"] : status === "PLACED" ? ["CONFIRMED"] : [])] } : { items: [] }
    }));
    const patch = vi.spyOn(api, "patch").mockImplementation(async (_url, body) => {
      status = (body as { status: string }).status;
      return { data: { status } };
    });
    renderWithProviders(<PurchaseOrdersPage />);
    await user.click(await screen.findByRole("button", { name: "Enviar pedido" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(status).toBe("PLACED"));
    expect(patch).toHaveBeenCalledWith("/purchase-orders/order-1/status", { status: "PLACED" }, expect.objectContaining({ headers: expect.objectContaining({ "x-store-id": testStores[0].id }) }));
    await user.click(await screen.findByRole("button", { name: "Confirmar pedido" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(status).toBe("CONFIRMED"));
    expect(patch).toHaveBeenCalledWith("/purchase-orders/order-1/status", { status: "CONFIRMED" }, expect.objectContaining({ headers: expect.objectContaining({ "x-store-id": testStores[0].id }) }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull());
  });

  it("não expõe ação sem autorização do read model e limpa ações ao trocar de loja", async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, "patch");
    renderWithProviders(<PurchaseOrdersPage />);
    await user.click(await screen.findByRole("button", { name: "Enviar pedido" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => useAuthStore.getState().setActiveStoreId(testStores[1].id));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enviar pedido" })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });
});
