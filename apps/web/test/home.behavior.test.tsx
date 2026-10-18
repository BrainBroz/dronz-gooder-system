import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { HomePage } from "../src/pages/HomePage";
import { renderWithProviders, testStores } from "./render";

const section = (codigo: string, quantidade: number) => ({
  codigo,
  titulo: `Seção ${codigo}`,
  rota: codigo === "CORRECOES" ? "/" : "/logistica",
  itens: [
    {
      codigo: `${codigo}_ITEM`,
      titulo: `Pendência ${codigo}`,
      quantidade,
      definicao: `Definição da pendência ${codigo}`
    }
  ]
});

beforeEach(() => vi.restoreAllMocks());

describe("Início (BE-HOME)", () => {
  it("mostra só as seções devolvidas pela API, com definição de cada contador", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home")
        return {
          data: {
            referenciaEm: "2026-10-17T12:00:00.000Z",
            secoes: [section("LOGISTICA", 3)]
          }
        };
      throw new Error(`GET inesperado: ${url}`);
    });
    renderWithProviders(<HomePage />);
    expect(await screen.findByText("Pendência LOGISTICA")).toBeTruthy();
    expect(screen.getByText("Definição da pendência LOGISTICA")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir" })).toBeTruthy();
    expect(screen.queryByText(/Financeiro/)).toBeNull();
    const [, config] = get.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(config.headers["x-store-id"]).toBe(testStores[0]!.id);
  });

  it("sem pendências avisa que não há ação; compensação pendente pode ser aprovada", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockImplementation(async (url) => {
      if (url === "/operations/home")
        return {
          data: {
            referenciaEm: "2026-10-17T12:00:00.000Z",
            secoes: [section("LOGISTICA", 0), section("CORRECOES", 0)]
          }
        };
      if (url === "/operations/corrections/requests")
        return {
          data: [
            {
              id: "req-1",
              createdAt: "2026-10-17T11:00:00.000Z",
              payload: {
                reason: "Avaria",
                adjustments: [{ quantityDelta: -1 }]
              },
              propostoPor: { name: "Ana" }
            }
          ]
        };
      throw new Error(`GET inesperado: ${url}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<HomePage />, {
      permissions: ["CORRECAO_PATRIMONIAL_APROVAR"]
    });
    expect(
      await screen.findByText("Nenhuma ação pendente neste contexto.")
    ).toBeTruthy();
    expect(await screen.findByText(/Ana: Avaria/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Rejeitar" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![0]).toBe(
      "/operations/corrections/requests/req-1/approve"
    );
  });
});
