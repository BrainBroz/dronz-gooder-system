import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { OrderTrackings } from "../src/components/OrderTrackings";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

describe("Destino por pacote (D-15)", () => {
  it("mostra o destino herdado e altera com motivo", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/positions")
        return {
          data: [{ id: "hotel", nome: "Hotel viajante", status: "ATIVA" }]
        };
      return {
        data: [
          {
            id: "t1",
            codigo: "1Z0",
            transportadora: "UPS",
            origem: "MARKETPLACE",
            ativo: true,
            pacote: "P1",
            pacoteId: "pkg-1",
            destino: { id: "base", nome: "Base Miami", origem: "PEDIDO" }
          }
        ]
      };
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(
      <OrderTrackings orderId="o1" store="store-dronz" canManage />
    );
    expect(
      await screen.findByText(/Pacote P1 → Base Miami \(padrão do pedido\)/)
    ).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Novo destino"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Hotel viajante" })
    );
    await userEvent.type(screen.getByLabelText("Motivo"), "Entrega no hotel");
    await userEvent.click(
      screen.getByRole("button", { name: "Alterar destino" })
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/purchase-orders/o1/packages/pkg-1/destination",
        { posicaoId: "hotel", motivo: "Entrega no hotel" },
        expect.anything()
      )
    );
  });

  it("sem gestão só mostra o destino", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: [
        {
          id: "t1",
          codigo: "1Z0",
          transportadora: null,
          origem: "MANUAL",
          ativo: true,
          pacote: "P1",
          pacoteId: "pkg-1",
          destino: { id: "h", nome: "Hotel", origem: "PACOTE" }
        }
      ]
    });
    renderWithProviders(
      <OrderTrackings orderId="o1" store="store-dronz" canManage={false} />
    );
    expect(await screen.findByText("Pacote P1 → Hotel")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Alterar destino" })
    ).toBeNull();
  });

  it("PD-04: declara o conteúdo do pacote", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/positions") return { data: [] };
      if (url === "/purchase-orders/o1")
        return {
          data: {
            itens: [{ id: "it-1", quantidade: 2, produto: { nome: "Drone" } }]
          }
        };
      return {
        data: [
          {
            id: "t1",
            codigo: "1Z0",
            transportadora: null,
            origem: "MANUAL",
            ativo: true,
            pacote: "P1",
            pacoteId: "pkg-1",
            destino: null,
            pacoteItens: []
          }
        ]
      };
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: {} });
    renderWithProviders(
      <OrderTrackings orderId="o1" store="store-dronz" canManage />
    );
    expect(await screen.findByText("Conteúdo: não declarado")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Item no pacote"));
    await userEvent.click(await screen.findByRole("option", { name: "Drone" }));
    await userEvent.type(screen.getByLabelText("Unidades"), "1");
    await userEvent.type(
      screen.getByLabelText("Motivo do conteúdo"),
      "Nota fiscal"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar conteúdo" })
    );
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        "/purchase-orders/o1/packages/pkg-1/items",
        {
          itens: [{ pedidoCompraItemId: "it-1", quantidade: 1 }],
          motivo: "Nota fiscal"
        },
        expect.anything()
      )
    );
  });
});
