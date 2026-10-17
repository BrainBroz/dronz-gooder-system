BEGIN;

-- The preceding repair conservatively compared raw orderedAt text. Restore
-- only untouched legacy candidates whose evidence is otherwise identical.
CREATE TEMP TABLE "_buyer_equivalent_legacy_dates" ON COMMIT DROP AS
WITH eligible AS (
  SELECT candidate."id"
  FROM "BuyerPurchaseCandidate" candidate
  WHERE candidate."status" = 'COM_DIVERGENCIA'
    AND candidate."compraImportadaId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "BuyerApprovalDecision" decision
      WHERE decision."candidateId" = candidate."id")
    AND EXISTS (SELECT 1 FROM "BuyerReconciliationConflict" conflict
      WHERE conflict."candidateId" = candidate."id"
        AND conflict."id" LIKE 'legacy-repair-%')
    AND NOT EXISTS (SELECT 1 FROM "BuyerReconciliationConflict" conflict
      WHERE conflict."candidateId" = candidate."id"
        AND conflict."id" NOT LIKE 'legacy-repair-%')
    AND NOT EXISTS (SELECT 1 FROM "BuyerEvidenceLink" link
      WHERE link."candidateId" = candidate."id"
        AND link."id" NOT LIKE 'legacy-%')
), signatures AS (
  SELECT eligible."id" AS "candidateId",
    evidence."normalizedPayload" - 'updatedAt' - 'shipments' - 'reference' - 'orderedAt'
      AS "materialPayload",
    (evidence."normalizedPayload"->>'orderedAt')::timestamptz AS "orderedAt"
  FROM eligible
  JOIN "BuyerEvidenceLink" link ON link."candidateId" = eligible."id"
  JOIN "BuyerEvidence" evidence ON evidence."id" = link."evidenceId"
)
SELECT "candidateId"
FROM signatures
GROUP BY "candidateId"
HAVING count(DISTINCT "materialPayload") = 1
  AND count(DISTINCT "orderedAt") = 1;

DELETE FROM "BuyerReconciliationConflict" conflict
USING "_buyer_equivalent_legacy_dates" safe
WHERE conflict."candidateId" = safe."candidateId"
  AND conflict."id" LIKE 'legacy-repair-%';

UPDATE "BuyerEvidenceLink" link
SET "type" = 'MATCHED'::"TipoVinculoEvidenciaCompra"
FROM "_buyer_equivalent_legacy_dates" safe
WHERE link."candidateId" = safe."candidateId";

UPDATE "BuyerPurchaseCandidate" candidate
SET "status" = 'AGUARDANDO_APROVACAO'::"EstadoCandidatoCompra",
  "version" = candidate."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_buyer_equivalent_legacy_dates" safe
WHERE candidate."id" = safe."candidateId";

COMMIT;
