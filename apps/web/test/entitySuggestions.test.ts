import { describe, expect, it } from "vitest";
import {
  accountSuggestions,
  merchantSuggestions
} from "../src/components/purchases/entitySuggestions";
import type { UnifiedPurchaseListItem } from "../src/types/unified-purchases";

function item(
  overrides: Partial<UnifiedPurchaseListItem> & { id: string }
): UnifiedPurchaseListItem {
  return {
    provider: "AMAZON",
    account: null,
    merchant: null,
    reference: overrides.id,
    orderedAt: null,
    currency: "USD",
    state: "EM_REVISAO",
    itemCount: 1,
    progress: { total: 1, assigned: 0, materialized: 0, pending: 1 },
    conflictCount: 0,
    allowedActions: [],
    blockedReasons: [],
    ...overrides
  };
}

function byId(suggestions: { id: string }[]) {
  return [...suggestions].sort((a, b) => a.id.localeCompare(b.id));
}

describe("entitySuggestions", () => {
  it("mesmo ID e mesmo provider: mantém uma única sugestão com o provider real", () => {
    const items = [
      item({ id: "p1", account: { id: "acc-1", name: "Conta A" }, provider: "AMAZON" }),
      item({ id: "p2", account: { id: "acc-1", name: "Conta A" }, provider: "AMAZON" })
    ];
    const result = accountSuggestions(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "acc-1", name: "Conta A", plataforma: "AMAZON" });
  });

  it("mesmo ID com providers distintos: nunca escolhe um silenciosamente, usa 'Múltiplas plataformas'", () => {
    const items = [
      item({ id: "p1", account: { id: "acc-1", name: "Conta A" }, provider: "AMAZON" }),
      item({ id: "p2", account: { id: "acc-1", name: "Conta A" }, provider: "EBAY" })
    ];
    const result = accountSuggestions(items);
    expect(result).toHaveLength(1);
    expect(result[0].plataforma).toBe("Múltiplas plataformas");
    expect(result[0].id).toBe("acc-1");
  });

  it("lista em ordem invertida produz o mesmo resultado lógico", () => {
    const forward = [
      item({ id: "p1", account: { id: "acc-1", name: "Conta A" }, provider: "AMAZON" }),
      item({ id: "p2", account: { id: "acc-1", name: "Conta A" }, provider: "EBAY" }),
      item({ id: "p3", account: { id: "acc-2", name: "Conta B" }, provider: "WALMART" })
    ];
    const reversed = [...forward].reverse();

    const forwardResult = byId(accountSuggestions(forward));
    const reversedResult = byId(accountSuggestions(reversed));

    expect(reversedResult).toEqual(forwardResult);
    expect(forwardResult.find((s) => s.id === "acc-1")?.plataforma).toBe(
      "Múltiplas plataformas"
    );
    expect(forwardResult.find((s) => s.id === "acc-2")?.plataforma).toBe("WALMART");
  });

  it("merchantSuggestions aplica a mesma regra de colisão", () => {
    const items = [
      item({ id: "p1", merchant: { id: "merch-1", name: "Merchant X" }, provider: "AMAZON" }),
      item({ id: "p2", merchant: { id: "merch-1", name: "Merchant X" }, provider: "AMAZON" }),
      item({ id: "p3", merchant: { id: "merch-2", name: "Merchant Y" }, provider: "OUTRA" })
    ];
    const result = byId(merchantSuggestions(items));
    expect(result).toEqual([
      { id: "merch-1", name: "Merchant X", plataforma: "AMAZON" },
      { id: "merch-2", name: "Merchant Y", plataforma: "OUTRA" }
    ]);
  });

  it("ignora itens sem account/merchant", () => {
    const items = [
      item({ id: "p1", account: null, merchant: null })
    ];
    expect(accountSuggestions(items)).toEqual([]);
    expect(merchantSuggestions(items)).toEqual([]);
  });

  it("mesmo ID com nomes distintos: nunca escolhe um silenciosamente, usa 'Múltiplos nomes', independente da ordem", () => {
    const forward = [
      item({ id: "p1", account: { id: "acc-1", name: "Conta Antiga" }, provider: "AMAZON" }),
      item({ id: "p2", account: { id: "acc-1", name: "Conta Renomeada" }, provider: "AMAZON" })
    ];
    const reversed = [...forward].reverse();

    const forwardResult = accountSuggestions(forward);
    const reversedResult = accountSuggestions(reversed);

    expect(forwardResult).toHaveLength(1);
    expect(forwardResult[0].name).toBe("Múltiplos nomes");
    expect(forwardResult[0].id).toBe("acc-1");
    expect(reversedResult).toEqual(forwardResult);
  });

  it("filtra sugestões pela plataforma informada, sem misturar contas de outra plataforma", () => {
    const items = [
      item({ id: "p1", account: { id: "acc-1", name: "Conta Amazon" }, provider: "AMAZON" }),
      item({ id: "p2", account: { id: "acc-2", name: "Conta Ebay" }, provider: "EBAY" })
    ];
    expect(accountSuggestions(items, "AMAZON")).toEqual([
      { id: "acc-1", name: "Conta Amazon", plataforma: "AMAZON" }
    ]);
    expect(accountSuggestions(items, "EBAY")).toEqual([
      { id: "acc-2", name: "Conta Ebay", plataforma: "EBAY" }
    ]);
  });
});
