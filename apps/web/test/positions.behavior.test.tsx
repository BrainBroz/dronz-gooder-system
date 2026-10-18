import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { PositionsPage } from "../src/pages/PositionsPage";
import { renderWithProviders, testStores } from "./render";

const position = (overrides: Record<string, unknown> = {}) => ({
  id: "pos-1",
  codigo: "ORL",
  nome: "Orlando",
  tipo: "TEMPORARIA",
  status: "ATIVA",
  inicioEm: "2026-10-01T00:00:00.000Z",
  fimEm: "2026-10-20T00:00:00.000Z",
  local: {
    cidade: "Orlando",
    estado: "FL",
    pais: "US",
    timezone: "America/New_York",
    alias: "Hotel"
  },
  responsabilidades: [],
  sugestaoEncerramento: false,
  allowedActions: [],
  blockedReasons: [
    {
      code: "ITEMS_NOT_RECEIVED",
      message: "1 item(ns) destinados ainda não recebidos."
    }
  ],
  ...overrides
});

beforeEach(() => vi.restoreAllMocks());

describe("Posições operacionais", () => {
  it("mostra bloqueios do backend e não oferece ação que a API não liberou", async () => {
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/positions") return { data: [position()] };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<PositionsPage />, {
      permissions: ["LOGISTICA_POSICOES_VISUALIZAR"]
    });
    expect(
      await screen.findByText("1 item(ns) destinados ainda não recebidos.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
    expect(screen.queryByText("Nova posição")).toBeNull();
    expect(screen.queryByText(/Endereço:/)).toBeNull();
  });

  it("exige motivo para reabrir e lê a disponibilidade da loja ativa", async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/positions")
        return {
          data: [
            position({
              status: "ENCERRADA",
              blockedReasons: [],
              allowedActions: ["REABRIR"]
            })
          ]
        };
      if (url === "/positions/pos-1/availability")
        return {
          data: [
            {
              pedidoCompraItemId: "item-1",
              pedido: { numeroPedido: "PO-1" },
              produto: { codigo: 101, nome: "Drone" },
              recebido: 4,
              reservado: 3,
              alocado: 0,
              disponivel: 1,
              aCaminho: 6
            }
          ]
        };
      throw new Error(`GET inesperado: ${url}`);
    });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<PositionsPage />, {
      permissions: ["LOGISTICA_POSICOES_GERENCIAR"]
    });
    const reopen = await screen.findByRole("button", { name: "Reabrir" });
    expect((reopen as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByLabelText("Motivo da reabertura"),
      "Pacote tardio"
    );
    await user.click(reopen);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toEqual({
      action: "REABRIR",
      motivo: "Pacote tardio"
    });

    await user.click(
      screen.getByRole("button", { name: "Ver disponibilidade" })
    );
    const table = await screen.findByRole("table", {
      name: "Disponibilidade operacional"
    });
    expect(table.textContent).toContain("101 · Drone");
    const availabilityCall = get.mock.calls.find(
      ([url]) => url === "/positions/pos-1/availability"
    );
    expect(
      (availabilityCall![1] as { headers: Record<string, string> }).headers[
        "x-store-id"
      ]
    ).toBe(testStores[0]!.id);
  });
});
