import type { Mala, Viagem } from "@prisma/client";
import { AppError } from "../../lib/app-error";

type CheckpointView = { tipoDivergencia: string } | null;

export function evaluateParaguayTransition(trip: Viagem, bag: Mala, checkpoint: CheckpointView) {
  if (!trip.checkpointsObrigatorios.includes("PARAGUAI"))
    return { status: "NOT_APPLICABLE" as const, allowed: false, blockedReason: "CHECKPOINT_NOT_APPLICABLE" };
  if (checkpoint)
    return checkpoint.tipoDivergencia === "CORRETO"
      ? { status: "COMPLETED" as const, allowed: false, blockedReason: "ALREADY_CONFIRMED" }
      : { status: "DIVERGENT" as const, allowed: false, blockedReason: "DIVERGENCE_UNRESOLVED" };
  if (trip.status !== "IN_TRANSIT" || bag.status !== "CHECKED_IN")
    return { status: "BLOCKED" as const, allowed: false, blockedReason: "INVALID_TRANSITION" };
  return { status: "PENDING" as const, allowed: true, blockedReason: null };
}

export function evaluateBrazilTransition(trip: Viagem, bag: Mala, paraguay: CheckpointView, brazil: CheckpointView) {
  if (brazil)
    return brazil.tipoDivergencia === "CORRETO"
      ? { status: "COMPLETED" as const, allowed: false, blockedReason: "ALREADY_CONFIRMED" }
      : { status: "DIVERGENT" as const, allowed: false, blockedReason: "DIVERGENCE_UNRESOLVED" };
  if (trip.status !== "ARRIVED_BRAZIL" || !trip.chegadaRealEm || !(["ARRIVED_BRAZIL", "RECEIVED"] as string[]).includes(bag.status))
    return { status: "BLOCKED" as const, allowed: false, blockedReason: "BRAZIL_ARRIVAL_REQUIRED" };
  if (trip.checkpointsObrigatorios.includes("PARAGUAI") && (!paraguay || paraguay.tipoDivergencia !== "CORRETO"))
    return { status: "BLOCKED" as const, allowed: false, blockedReason: paraguay ? "DIVERGENCE_UNRESOLVED" : "CHECKPOINT_REQUIRED" };
  return { status: "PENDING" as const, allowed: true, blockedReason: null };
}

export function evaluateReceivingTransition(trip: Viagem, bag: Mala, paraguay: CheckpointView, brazil: CheckpointView, alreadyOpen: boolean) {
  if (alreadyOpen) return { allowed: false, blockedReason: "RECEIVING_ALREADY_OPEN" };
  const brazilEvaluation = evaluateBrazilTransition(trip, bag, paraguay, brazil);
  if (brazilEvaluation.status !== "COMPLETED")
    return { allowed: false, blockedReason: brazilEvaluation.blockedReason ?? "BRAZIL_ARRIVAL_REQUIRED" };
  return { allowed: true, blockedReason: null };
}

// X-07/DEC-DOM-003: sobra, item incorreto ou divergência genérica não resolvida bloqueiam a entrada
// do próprio item; falta e avaria mantêm as unidades aptas elegíveis.
const ITEM_BLOCKING_DIVERGENCES = ["EXCESSO", "ITEM_INCORRETO", "OUTRO"];
export function aptPendingQuantity(item: {
  quantidadeEsperada: number;
  quantidadeRecebida: number;
  quantidadeRejeitada: number;
  quantidadeJaIncorporada: number;
  tipoDivergencia?: string | null;
  divergenciaResolvida: boolean;
}) {
  if (!item.divergenciaResolvida && ITEM_BLOCKING_DIVERGENCES.includes(item.tipoDivergencia ?? "")) return 0;
  return Math.max(0, Math.min(item.quantidadeEsperada, item.quantidadeRecebida - item.quantidadeRejeitada) - item.quantidadeJaIncorporada);
}

export function evaluateDefinitiveEntry(input: {
  brazil: CheckpointView;
  paraguayRequired: boolean;
  paraguay: CheckpointView;
  receivingOpened: boolean;
  impactQuantity: number;
  miamiComplete: boolean;
}) {
  const blockers: string[] = [];
  if (!input.brazil) blockers.push("BRAZIL_ARRIVAL_REQUIRED");
  else if (input.brazil.tipoDivergencia !== "CORRETO") blockers.push("DIVERGENCE_UNRESOLVED");
  if (input.paraguayRequired && !input.paraguay) blockers.push("CHECKPOINT_REQUIRED");
  else if (input.paraguayRequired && input.paraguay?.tipoDivergencia !== "CORRETO") blockers.push("DIVERGENCE_UNRESOLVED");
  if (!input.receivingOpened) blockers.push("RECEIVING_NOT_STARTED");
  if (input.impactQuantity <= 0) blockers.push("NO_APT_QUANTITY");
  if (!input.miamiComplete) blockers.push("MISSING_CHECKPOINT_MIAMI");
  return { allowed: blockers.length === 0, blockedReasons: [...new Set(blockers)] };
}

export function assertParaguayTransition(trip: Viagem, bag: Mala) {
  const evaluation = evaluateParaguayTransition(trip, bag, null);
  if (!evaluation.allowed) throw new AppError(409, evaluation.blockedReason!.toLowerCase());
}

export function assertBrazilTransition(trip: Viagem, bag: Mala, paraguay: CheckpointView) {
  const evaluation = evaluateBrazilTransition(trip, bag, paraguay, null);
  if (!evaluation.allowed) throw new AppError(409, evaluation.blockedReason!.toLowerCase());
}
