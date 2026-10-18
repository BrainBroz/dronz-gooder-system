import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { SalesPage } from "../src/pages/SalesPage";
import { renderWithProviders } from "./render";

const draft = {
  id: "sale-1",
  canal: "MERCADO_LIVRE",
  referenciaExterna: "ML-1",
  dataVenda: "2026-10-18T12:00:00.000Z",
  moeda: "BRL",
  estado: "RASCUNHO",
  receitaBruta: "400.00",
  receitaLiquida: "312.00",
  recebivel: null,
  itens: [
    {
      id: "item-1",
      produto: { nome: "Drone" },
      quantidade: 2,
      precoUnitario: "200.00"
    }
  ]
};

function mockReads(suggestion: unknown) {
  return vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/sales") return { data: [draft] };
    if (url === "/products") return { data: { items: [] } };
    if (url === "/sales/sale-1/lot-suggestion") return { data: suggestion };
    throw new Error(`GET inesperado: ${url}`);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("Vendas B17", () => {
  it("confirma a venda com os lotes FIFO sugeridos", async () => {
    mockReads({
      itens: [
        {
          vendaItemId: "item-1",
          faltante: 0,
          lotes: [
            {
              movimentoEntradaId: "lot-1",
              quantidade: 2,
              entradaEm: "2026-10-01T00:00:00.000Z",
              pedido: "PO-9",
              custoConhecido: true
            }
          ]
        }
      ]
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sugerir lotes (FIFO)" })
    );
    expect(await screen.findByText(/pedido PO-9/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar venda e baixar estoque" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales/sale-1/confirm",
        {
          lotes: [
            {
              vendaItemId: "item-1",
              movimentoEntradaId: "lot-1",
              quantidade: 2
            }
          ]
        },
        expect.anything()
      )
    );
    expect(screen.queryByText("Nova venda (rascunho)")).toBeNull();
  });

  it("saldo Brasil insuficiente bloqueia a confirmação", async () => {
    mockReads({ itens: [{ vendaItemId: "item-1", faltante: 2, lotes: [] }] });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CONFIRMAR"]
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Sugerir lotes (FIFO)" })
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Confirmar venda e baixar estoque" })
    ).toBeNull();
  });
});
