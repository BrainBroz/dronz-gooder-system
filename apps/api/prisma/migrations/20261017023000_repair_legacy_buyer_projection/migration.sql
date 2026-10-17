BEGIN;

-- Only untouched candidates from the original backfill are eligible. Human
-- decisions, later ingestion, linked purchases and prior conflict work remain intact.
CREATE TEMP TABLE "_buyer_legacy_repair" ON COMMIT DROP AS
WITH eligible AS (
  SELECT candidate."id"
  FROM "BuyerPurchaseCandidate" candidate
  WHERE candidate."status" IN ('AGUARDANDO_APROVACAO', 'CANCELADA')
    AND candidate."compraImportadaId" IS NULL
    AND EXISTS (SELECT 1 FROM "BuyerEvidenceLink" link
      WHERE link."candidateId" = candidate."id")
    AND NOT EXISTS (SELECT 1 FROM "BuyerEvidenceLink" link
      WHERE link."candidateId" = candidate."id" AND link."id" NOT LIKE 'legacy-%')
    AND NOT EXISTS (SELECT 1 FROM "BuyerApprovalDecision" decision
      WHERE decision."candidateId" = candidate."id")
    AND NOT EXISTS (SELECT 1 FROM "BuyerReconciliationConflict" conflict
      WHERE conflict."candidateId" = candidate."id")
), ranked AS (
  SELECT link."candidateId", evidence."id" AS "evidenceId",
    evidence."normalizedPayload"->>'cancelled' = 'true' AS "cancelled",
    evidence."normalizedPayload" - 'updatedAt' - 'shipments' - 'reference'
      AS "materialPayload",
    row_number() OVER (PARTITION BY link."candidateId"
      ORDER BY evidence."sourceOccurredAt" DESC,
        (evidence."normalizedPayload"->>'cancelled' = 'true') DESC,
        evidence."version" DESC, evidence."id" DESC) AS "rank"
  FROM eligible
  JOIN "BuyerEvidenceLink" link ON link."candidateId" = eligible."id"
  JOIN "BuyerEvidence" evidence ON evidence."id" = link."evidenceId"
), latest AS (
  SELECT * FROM ranked WHERE "rank" = 1
)
SELECT ranked."candidateId", ranked."evidenceId",
  latest."evidenceId" AS "latestEvidenceId", latest."cancelled" AS "latestCancelled",
  ranked."materialPayload" IS DISTINCT FROM latest."materialPayload" AS "materiallyDifferent"
FROM ranked
JOIN latest ON latest."candidateId" = ranked."candidateId";

UPDATE "BuyerPurchaseCandidate" candidate
SET "currentEvidenceId" = repair."latestEvidenceId",
  "status" = CASE
    WHEN repair."latestCancelled" THEN 'CANCELADA'::"EstadoCandidatoCompra"
    WHEN repair."hasDivergence" THEN 'COM_DIVERGENCIA'::"EstadoCandidatoCompra"
    ELSE 'AGUARDANDO_APROVACAO'::"EstadoCandidatoCompra" END,
  "version" = candidate."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "candidateId", max("latestEvidenceId") AS "latestEvidenceId",
    bool_or("latestCancelled") AS "latestCancelled",
    bool_or("materiallyDifferent") AS "hasDivergence"
  FROM "_buyer_legacy_repair" GROUP BY "candidateId"
) repair
WHERE candidate."id" = repair."candidateId"
  AND (candidate."currentEvidenceId" <> repair."latestEvidenceId"
    OR candidate."status" <> CASE
      WHEN repair."latestCancelled" THEN 'CANCELADA'::"EstadoCandidatoCompra"
      WHEN repair."hasDivergence" THEN 'COM_DIVERGENCIA'::"EstadoCandidatoCompra"
      ELSE 'AGUARDANDO_APROVACAO'::"EstadoCandidatoCompra" END);

UPDATE "BuyerEvidenceLink" link
SET "type" = 'CONFLICTING'::"TipoVinculoEvidenciaCompra"
FROM "_buyer_legacy_repair" repair
WHERE link."candidateId" = repair."candidateId"
  AND link."evidenceId" = repair."evidenceId"
  AND repair."materiallyDifferent";

INSERT INTO "BuyerReconciliationConflict" (
  "id", "candidateId", "referenceEvidenceId", "evidenceId", "type"
)
SELECT 'legacy-repair-' || md5(repair."candidateId" || ':' || repair."evidenceId"),
  repair."candidateId", repair."latestEvidenceId", repair."evidenceId",
  'LEGACY_UNCLASSIFIED'::"TipoConflitoEvidenciaCompra"
FROM "_buyer_legacy_repair" repair
WHERE repair."materiallyDifferent"
ON CONFLICT ("candidateId", "evidenceId", "type") DO NOTHING;

COMMIT;
