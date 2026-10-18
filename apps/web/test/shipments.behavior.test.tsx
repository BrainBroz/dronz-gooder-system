import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { LogisticsPage } from "../src/pages/LogisticsPage";
import { renderWithProviders } from "./render";

const box = {
  id: "box-a",
  codigo: "CX-A",
  status: "CLOSED",
  limitePesoKg: null,
  tipo: "CAIXA",
  posicaoId: "posicao-miami-base",
  grupoFisico: null,
  handoffs: [],
  volumes: [{ id: "v-a", codigo: "V-A" }],
  alocacoes: [{ id: "al-a" }],
  allowedStatusTransitions: ["CHECKED_IN", "PLANNING"]
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/logistics/suitcases") return { data: [box] };
    if (
      [
        "/logistics/travelers",
        "/logistics/trips",
        "/positions",
        "/logistics/physical-groups"
      ].includes(url as string)
    )
      return { data: [] };
    throw new Error(`GET inesperado: ${url}`);
  });
});

describe("Envios — caixa aérea e handoff", () => {
  it("entrega de caixa exige referência do recibo e a envia ao backend", async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    expect(
      await screen.findByText(/Caixa · Limite não informado/)
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Registrar entrega (handoff)" })
    );
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirmar"
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(
      within(dialog).getByLabelText(/Referência do recibo/),
      "AWB-9"
    );
    await user.click(confirm);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![0]).toBe("/logistics/suitcases/box-a/status");
    expect(patch.mock.calls[0]![1]).toEqual({
      status: "CHECKED_IN",
      referencia: "AWB-9"
    });
  });

  it("viagem em caixa aérea pede transportadora em vez de viajante", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<LogisticsPage />);
    await user.click(await screen.findByLabelText("Modalidade"));
    await user.click(screen.getByRole("option", { name: "Caixa aérea" }));
    expect(screen.queryByLabelText("Viajante")).toBeNull();
    await user.type(screen.getByLabelText("Transportadora"), "Aero Cargo");
    await user.type(screen.getByLabelText("Origem"), "Miami");
    await user.type(screen.getByLabelText("Destino"), "São Paulo");
    await user.type(screen.getByLabelText("Partida"), "2026-11-01T10:00");
    await user.type(
      screen.getByLabelText("Chegada prevista"),
      "2026-11-02T10:00"
    );
    await user.click(screen.getByRole("button", { name: "Criar viagem" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/logistics/trips");
    expect(body).toMatchObject({
      modalidade: "CAIXA_AEREA",
      transportadora: "Aero Cargo",
      origem: "Miami"
    });
    expect(body).not.toHaveProperty("viajanteId");
  });
});
