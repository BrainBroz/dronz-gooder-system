import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { SalesPage } from "../src/pages/SalesPage";
import { renderWithProviders } from "./render";

const sale = (devolucoes: unknown[] = []) => ({
  id: "sale-1",
  canal: "SHOPEE",
  referenciaExterna: null,
  dataVenda: "2026-10-18T12:00:00.000Z",
  moeda: "BRL",
  estado: "CONFIRMADA",
  receitaBruta: "200.00",
  receitaLiquida: "200.00",
  recebivel: {
    valorPrevisto: "200.00",
    valorRecebido: "0.00",
    status: "PENDENTE"
  },
  devolucoes,
  itens: [
    {
      id: "item-1",
      produto: { nome: "Drone" },
      quantidade: 2,
      precoUnitario: "100.00"
    }
  ]
});

function mockReads(data: unknown) {
  vi.spyOn(api, "get").mockImplementation(async (url) =>
    url === "/sales" ? { data: [data] } : { data: { items: [] } }
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("PD-01/PD-02 na tela de vendas", () => {
  it("estorno exige motivo e envia itemNaoSaiu com chave idempotente", async () => {
    mockReads(sale());
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "VENDA_CORRIGIR"]
    });
    const button = await screen.findByRole("button", {
      name: "Estornar (item não saiu)"
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(
      screen.getByLabelText("Motivo do estorno"),
      "Cancelado antes do envio"
    );
    await userEvent.click(button);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales/sale-1/reverse",
        { motivo: "Cancelado antes do envio", itemNaoSaiu: true },
        expect.objectContaining({
          headers: expect.objectContaining({
            "idempotency-key": expect.any(String)
          })
        })
      )
    );
    expect(
      screen.queryByRole("button", { name: "Registrar devolução" })
    ).toBeNull();
  });

  it("devolução pendente aparece e a conferência apta envia condição e funcionamento", async () => {
    mockReads(
      sale([
        {
          id: "dev-1",
          vendaItemId: "item-1",
          quantidade: 1,
          estado: "PENDENTE",
          motivo: "Arrependimento"
        }
      ])
    );
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<SalesPage />, {
      permissions: ["VENDA_VISUALIZAR", "DEVOLUCAO_CONFERIR"]
    });
    expect(await screen.findByText(/aguardando conferência/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Conferir: apta (volta ao estoque)" })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/sales/returns/dev-1/check",
        {
          apta: true,
          condicaoComercial: "CAIXA_ABERTA",
          funcionamento: "FUNCIONAL"
        },
        expect.anything()
      )
    );
  });
});
