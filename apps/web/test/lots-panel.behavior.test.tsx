import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { LotsPanel } from "../src/components/LotsPanel";
import { renderWithProviders } from "./render";

beforeEach(() => vi.restoreAllMocks());

describe("Lotes do estoque (PD-03)", () => {
  it("mostra a divergência e reconcilia com motivo", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        estoqueFisico: 2,
        saldoLotes: 3,
        reconciliado: false,
        lotes: [
          {
            movimentoEntradaId: "l1",
            tipo: "ENTRY",
            entradaEm: "2026-01-01T00:00:00Z",
            quantidade: 2,
            restante: 2,
            custoConhecido: true
          },
          {
            movimentoEntradaId: "l2",
            tipo: "ADJUSTMENT_POSITIVE",
            entradaEm: "2026-02-01T00:00:00Z",
            quantidade: 1,
            restante: 1,
            custoConhecido: false
          }
        ],
        saidasSemLote: [
          {
            id: "o1",
            tipo: "EXIT",
            motivo: "LOSS",
            createdAt: "2026-03-01T00:00:00Z",
            pendente: 1
          }
        ]
      }
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(
      <LotsPanel products={[{ produtoId: "p1", nome: "Drone" }]} />,
      {
        permissions: ["ESTOQUE_VISUALIZAR", "ESTOQUE_AJUSTAR"]
      }
    );
    await userEvent.click(screen.getByLabelText("Produto"));
    await userEvent.click(await screen.findByRole("option", { name: "Drone" }));
    expect(await screen.findByText(/precisa de reconciliação/)).toBeTruthy();
    expect(screen.getByText(/sem custo de compra/)).toBeTruthy();
    expect(screen.getByText(/Saída sem lote: EXIT\/LOSS/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Motivo"), "Perda antiga");
    await userEvent.click(
      screen.getByRole("button", {
        name: "Reconciliar saídas com os lotes mais antigos"
      })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/inventory/lots/p1/reconcile",
        { motivo: "Perda antiga" },
        expect.objectContaining({
          headers: expect.objectContaining({
            "idempotency-key": expect.any(String)
          })
        })
      )
    );
  });

  it("sem ESTOQUE_AJUSTAR só lê", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        estoqueFisico: 1,
        saldoLotes: 1,
        reconciliado: true,
        lotes: [],
        saidasSemLote: []
      }
    });
    renderWithProviders(
      <LotsPanel products={[{ produtoId: "p1", nome: "Drone" }]} />,
      {
        permissions: ["ESTOQUE_VISUALIZAR"]
      }
    );
    await userEvent.click(screen.getByLabelText("Produto"));
    await userEvent.click(await screen.findByRole("option", { name: "Drone" }));
    expect(await screen.findByText(/reconciliado/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reconciliar/ })).toBeNull();
  });
});
