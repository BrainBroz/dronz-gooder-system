import { ContaPatrimonial, Lote } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import type { RegistrarMovimentoInput } from "./ledger.service";

/**
 * Regras e invariantes do ledger (ARQUITETURA_OPERACIONAL_V2 §5).
 *
 * Contas terminais de fronteira (EXTERNAL_SUPPLIER, SOLD, LOST, WRITTEN_OFF)
 * não possuem localização. QUARANTINE, SELLABLE, RESERVED e OWNED_AT_LOCATION
 * são estados físicos e exigem localização. OWNED_IN_TRANSIT e
 * RETURN_IN_TRANSIT representam deslocamento e aceitam localização opcional.
 */
const LOCALIZACAO_PROIBIDA: ReadonlySet<ContaPatrimonial> = new Set([
  "EXTERNAL_SUPPLIER",
  "SOLD",
  "LOST",
  "WRITTEN_OFF"
]);

const LOCALIZACAO_OBRIGATORIA: ReadonlySet<ContaPatrimonial> = new Set([
  "OWNED_AT_LOCATION",
  "QUARANTINE",
  "SELLABLE",
  "RESERVED"
]);

/** Contas cujo saldo nunca pode ser negativo (§5.1/§5.2). */
const SALDO_NAO_NEGATIVO: ReadonlySet<ContaPatrimonial> = new Set([
  "OWNED_IN_TRANSIT",
  "OWNED_AT_LOCATION",
  "QUARANTINE",
  "SELLABLE",
  "RESERVED",
  "RETURN_IN_TRANSIT",
  "SOLD",
  "LOST"
]);

/** Normaliza a localização de um lançamento conforme a conta. */
export function normalizarLocalizacao(
  conta: ContaPatrimonial,
  localizacaoId: string | null | undefined
): string | null {
  if (LOCALIZACAO_PROIBIDA.has(conta)) {
    if (localizacaoId) throw new AppError(400, "location_not_allowed");
    return null;
  }
  if (LOCALIZACAO_OBRIGATORIA.has(conta) && !localizacaoId)
    throw new AppError(400, "location_required");
  return localizacaoId ?? null;
}

/**
 * Valida um movimento antes da gravação:
 *  - deltas inteiros e não nulos;
 *  - lotes ACTIVE (lote fechado não recebe movimento, salvo reversão — §3.2);
 *  - conservação: Σ quantidadeDelta = 0 por produto dentro do movimento (§5.2).
 */
export function assertLancamentosValidos(
  input: RegistrarMovimentoInput,
  loteById: Map<string, Lote>
) {
  const somaPorProduto = new Map<string, number>();

  for (const l of input.lancamentos) {
    if (!Number.isInteger(l.quantidadeDelta) || l.quantidadeDelta === 0)
      throw new AppError(400, "bad_delta");

    const lote = loteById.get(l.loteId)!;
    if (lote.lifecycleStatus !== "ACTIVE" && input.tipo !== "ADMIN_REVERSAL")
      throw new AppError(409, "lote_closed");

    somaPorProduto.set(
      lote.produtoId,
      (somaPorProduto.get(lote.produtoId) ?? 0) + l.quantidadeDelta
    );
  }

  for (const [, soma] of somaPorProduto) {
    if (soma !== 0) throw new AppError(400, "unbalanced_movement");
  }
}

/**
 * Invariante de domínio do saldo resultante (§5.1) — validado ANTES da escrita,
 * sob lock, para responder com erro de negócio; o CHECK do banco é a rede de
 * segurança final:
 *  - EXTERNAL_SUPPLIER <= 0 (cancelamento nunca a torna positiva);
 *  - SOLD/LOST >= 0 (devolução/recuperação limitadas ao acumulado);
 *  - contas físicas >= 0 (saldo insuficiente bloqueia o movimento);
 *  - WRITTEN_OFF é conta técnica de fronteira e pode ter saldo assinado.
 */
export function assertSaldoDominio(conta: ContaPatrimonial, saldo: number) {
  if (conta === "EXTERNAL_SUPPLIER" && saldo > 0)
    throw new AppError(409, "external_supplier_positive");
  if (SALDO_NAO_NEGATIVO.has(conta) && saldo < 0)
    throw new AppError(409, "insufficient_balance");
}

/**
 * Chaves de advisory lock por lojaId+produtoId+loteId, em ordem lexicográfica
 * determinística para prevenir deadlocks (§3.4).
 */
export function chavesDeLock(lojaId: string, lotes: Lote[]): string[] {
  const chaves = new Set(
    lotes.map((l) => `ledger:${lojaId}:${l.produtoId}:${l.id}`)
  );
  return [...chaves].sort();
}
