import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { BuyerReviewPage } from "../src/pages/BuyerReviewPage";
import { renderWithProviders } from "./render";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: "cand-1",
  provider: "AMAZON",
  account: { id: "acc-1", name: "Amazon Business" },
  externalOrderId: "111-222",
  status: "AGUARDANDO_APROVACAO",
  version: 3,
  purchaseId: null,
  order: {
    orderedAt: "2026-10-01T10:00:00.000Z",
    currency: "USD",
    total: 50,
    items: [{ title: "Drone", quantity: 5, unitPrice: 10 }]
  },
  currentEvidence: { source: "AMAZON_BUSINESS_API" },
  allowedActions: ["VIEW", "APPROVE", "REJECT"],
  blockedReasons: [],
  confianca: {
    score: 45,
    faixa: "BAIXA",
    versao: "X-03-v1",
    sinais: [{ codigo: "E", valor: 0, motivo: "Apenas uma fonte" }]
  },
  ...overrides
});

function mockReads(items: unknown[], conflicts: unknown[] = []) {
  return vi.spyOn(api, "get").mockImplementation(async (url) => {
    if (url === "/integrations/marketplaces/buyer-candidates")
      return { data: { items, total: items.length } };
    if (url === "/integrations/marketplaces/buyer-evidence/unidentified")
      return { data: [] };
    if (url === "/imported-purchases/accounts") return { data: [] };
    if (url === "/integrations/marketplaces/buyer-candidates/cand-1/conflicts")
      return { data: { items: conflicts } };
    throw new Error(`GET inesperado: ${url}`);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("Revisão buyer", () => {
  it("mostra a confiança como prioridade e aprova com versão esperada e chave idempotente", async () => {
    const user = userEvent.setup();
    mockReads([candidate()]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<BuyerReviewPage />, {
      permissions: ["BUYER_INGESTION_VISUALIZAR", "BUYER_INGESTION_APROVAR"]
    });
    expect(await screen.findByText(/Confiança 45\/100 \(BAIXA\)/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Rejeitar" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Aprovar compra" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body, config] = post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> }
    ];
    expect(url).toBe(
      "/integrations/marketplaces/buyer-candidates/cand-1/decision"
    );
    expect(body).toEqual({ decision: "APROVAR", expectedVersion: 3 });
    expect(config.headers["idempotency-key"]).toMatch(/.{8,}/);
  });

  it("divergência só se resolve com motivo e escolha de evidência", async () => {
    const user = userEvent.setup();
    mockReads(
      [
        candidate({
          status: "COM_DIVERGENCIA",
          allowedActions: ["VIEW", "REJECT", "RESOLVE_CONFLICT"],
          blockedReasons: ["MATERIAL_DIVERGENCE"]
        })
      ],
      [
        {
          id: "c1",
          type: "QUANTITY",
          status: "ABERTO",
          evidenceId: "ev-email",
          referenceEvidenceId: "ev-api"
        }
      ]
    );
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });
    renderWithProviders(<BuyerReviewPage />, {
      permissions: ["BUYER_INGESTION_VISUALIZAR", "BUYER_INGESTION_APROVAR"]
    });
    expect(
      await screen.findByText(
        "Fontes divergentes: resolva a divergência antes de aprovar."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aprovar compra" })).toBeNull();
    const keep = await screen.findByRole("button", {
      name: "Manter evidência anterior"
    });
    expect((keep as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByLabelText("Motivo da resolução"),
      "API é oficial"
    );
    await user.click(keep);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({
      evidenceId: "ev-email",
      resolution: "MANTER_REFERENCIA",
      reason: "API é oficial",
      expectedVersion: 3
    });
  });
});
