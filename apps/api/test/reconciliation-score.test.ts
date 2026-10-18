import { describe, expect, it } from "vitest";
import { reconciliationScore } from "../src/modules/marketplace-integrations/reconciliation-score";

const order = {
  externalOrderId: "A-1",
  reference: "A-1",
  orderedAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T11:00:00.000Z",
  currency: "USD",
  cancelled: false,
  shipments: [],
  items: [
    {
      title: "Drone",
      quantity: 2,
      cancelledQuantity: 0,
      refundedQuantity: 0,
      unitPrice: 100,
      currency: "USD"
    }
  ]
};

describe("X-03 confiança de conciliação", () => {
  it("uma fonte só: dados estruturados valem 0,5 e concordância 0 (score 45, BAIXA)", () => {
    expect(
      reconciliationScore({
        order,
        hasStrongIdentity: true,
        sources: ["AMAZON_BUSINESS_API"],
        openConflicts: []
      })
    ).toMatchObject({ score: 45, faixa: "BAIXA", versao: "X-03-v1" });
  });

  it("duas fontes independentes concordando: 100, ALTA; cópia da mesma fonte não conta", () => {
    expect(
      reconciliationScore({
        order,
        hasStrongIdentity: true,
        sources: ["AMAZON_BUSINESS_API", "EMAIL_AMAZON"],
        openConflicts: []
      }).score
    ).toBe(100);
    expect(
      reconciliationScore({
        order,
        hasStrongIdentity: true,
        sources: ["EMAIL_AMAZON", "EMAIL_AMAZON"],
        openConflicts: []
      }).score
    ).toBe(45);
  });

  it("conflito de quantidade zera Q e E (65, MEDIA) e nunca carrega efeito de aprovação", () => {
    const result = reconciliationScore({
      order,
      hasStrongIdentity: true,
      sources: ["AMAZON_BUSINESS_API", "EMAIL_AMAZON"],
      openConflicts: ["QUANTITY"]
    });
    expect(result).toMatchObject({ score: 65, faixa: "MEDIA" });
    expect(Object.keys(result)).toEqual(["versao", "score", "faixa", "sinais"]);
  });
});
