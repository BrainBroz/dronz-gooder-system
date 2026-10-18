import React from "react";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { MonthlyPanelPage } from "../src/pages/MonthlyPanelPage";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

describe("Painel mensal", () => {
  it("mostra cada moeda separada, valores por loja, pendente e itens fora dos totais", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: {
        competencia: { ano: 2031, mes: 3, timezone: "America/Sao_Paulo" },
        referenciaEm: "2031-04-02T12:00:00.000Z",
        moedas: [
          {
            moeda: "USD",
            pedidos: 2,
            linhas: 2,
            unidades: 11,
            bruto: "1010.00",
            cancelado: "100.00",
            reembolsado: "0.00",
            liquido: "910.00",
            pendenteAtribuicao: "100.00",
            materializado: "600.00",
            naoRateado: "50.00",
            lojas: [
              {
                lojaId: "d",
                nome: "Dronz",
                valor: "600.00",
                unidades: 6,
                pedidos: 1
              },
              {
                lojaId: "g",
                nome: "Gooder",
                valor: "210.00",
                unidades: 3,
                pedidos: 2
              }
            ]
          },
          {
            moeda: "BRL",
            pedidos: 1,
            linhas: 1,
            unidades: 2,
            bruto: "100.00",
            cancelado: "0.00",
            reembolsado: "0.00",
            liquido: "100.00",
            pendenteAtribuicao: "100.00",
            materializado: "0.00",
            naoRateado: "0.00",
            lojas: []
          }
        ],
        pendentesAprovacao: [{ moeda: "USD", candidatos: 3, valor: "75.00" }],
        semDataPedido: 4,
        conflitosAbertos: 1,
        mappingsPendentes: 2,
        definicoes: {
          competencia: "Mês de dataPedido no fuso America/Sao_Paulo (X-13)."
        }
      }
    });
    renderWithProviders(<MonthlyPanelPage />, {
      permissions: ["COMPRAS_IMPORTADAS_VISUALIZAR"]
    });
    expect(await screen.findByText(/USD · 2 pedido\(s\)/)).toBeTruthy();
    expect(screen.getByText(/BRL · 1 pedido\(s\)/)).toBeTruthy();
    expect(screen.getByText("Dronz")).toBeTruthy();
    expect(screen.getByText(/4 compra\(s\) sem data do pedido/)).toBeTruthy();
    expect(screen.getByText(/3 candidato\(s\)/)).toBeTruthy();
    expect(get.mock.calls[0]![0]).toBe("/imported-purchases/monthly");
  });
});
