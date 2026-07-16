import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";

export type PurchasePriority = "critical" | "high" | "normal" | "done";

/**
 * Prioridade visual — deriva exclusivamente de blockedReasons, progress e
 * allowedActions já retornados pelo backend. Nunca considera idade e nunca
 * decide elegibilidade: é somente cor de atenção sobre dados existentes.
 */
export function purchasePriority(item: UnifiedPurchaseListItem): PurchasePriority {
  if (item.progress.total > 0 && item.progress.materialized === item.progress.total) {
    return "done";
  }
  const hasConflict = item.blockedReasons.some((reason) =>
    reason.code.toLowerCase().includes("conflict")
  );
  if (hasConflict) return "critical";
  if (item.blockedReasons.length > 0) return "high";
  return "normal";
}

export const priorityLabel: Record<PurchasePriority, string> = {
  critical: "Crítico",
  high: "Alto",
  normal: "Normal",
  done: "Concluído"
};
