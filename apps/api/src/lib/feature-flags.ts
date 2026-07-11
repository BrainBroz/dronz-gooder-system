/**
 * Feature flags da migração incremental (ARQUITETURA_OPERACIONAL_V2 §16).
 *
 * Flags separadas para write e read. Leitura em runtime (não no import) para
 * permitir alternância em testes e operação. O cutover NÃO é habilitado neste
 * ciclo — a leitura oficial permanece no legado até os critérios das Fases
 * 2–4 serem atendidos.
 */
export const flags = {
  /** Fase 2 — shadow write: legado + ledger na mesma transação. */
  get ledgerShadowWrite(): boolean {
    return process.env.LEDGER_SHADOW_WRITE === "true";
  },
  /** Fase 3 — shadow read: leitura paralela com comparação, sem trocar a fonte. */
  get ledgerShadowRead(): boolean {
    return process.env.LEDGER_SHADOW_READ === "true";
  }
};
