BEGIN;

-- Only untouched legacy candidates may be reprojected. Decisions, linked
-- purchases, newer ingestion and existing conflict work remain unchanged.
CREATE TEMP TABLE "_buyer_legacy_shipping" ON COMMIT DROP AS
WITH eligible AS (
  SELECT candidate."id"
  FROM "BuyerPurchaseCandidate" candidate
  WHERE candidate."status" = 'AGUARDANDO_APROVACAO'
    AND candidate."compraImportadaId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "BuyerApprovalDecision" decision
      WHERE decision."candidateId" = candidate."id")
    AND NOT EXISTS (SELECT 1 FROM "BuyerReconciliationConflict" conflict
      WHERE conflict."candidateId" = candidate."id")
    AND EXISTS (SELECT 1 FROM "BuyerEvidenceLink" link
      WHERE link."candidateId" = candidate."id")
    AND NOT EXISTS (SELECT 1 FROM "BuyerEvidenceLink" link
      WHERE link."candidateId" = candidate."id" AND link."id" NOT LIKE 'legacy-%')
), snapshots AS (
  SELECT link."candidateId", evidence."id" AS "evidenceId",
    evidence."sourceOccurredAt" AS "orderTime",
    COALESCE(evidence."normalizedPayload"->>'cancelled' = 'true', false) AS "cancelled",
    COALESCE(evidence."normalizedPayload"->'shipments', '[]'::jsonb) AS "shipments",
    evidence."normalizedPayload" - 'updatedAt' - 'shipments' - 'reference' - 'orderedAt'
      AS "materialPayload",
    (evidence."normalizedPayload"->>'orderedAt')::timestamptz AS "orderedAt",
    shipping."lastEvent" AS "shippingTime", evidence."payloadHash"
  FROM eligible
  JOIN "BuyerEvidenceLink" link ON link."candidateId" = eligible."id"
  JOIN "BuyerEvidence" evidence ON evidence."id" = link."evidenceId"
  LEFT JOIN LATERAL (
    SELECT max(event_time) AS "lastEvent"
    FROM (
      SELECT (shipment.value->>'updatedAt')::timestamptz AS event_time
      FROM jsonb_array_elements(COALESCE(evidence."normalizedPayload"->'shipments', '[]'::jsonb)) shipment
      UNION ALL
      SELECT (tracking.value->>'updatedAt')::timestamptz AS event_time
      FROM jsonb_array_elements(COALESCE(evidence."normalizedPayload"->'shipments', '[]'::jsonb)) shipment
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(shipment.value->'packages', '[]'::jsonb)) package
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(package.value->'trackings', '[]'::jsonb)) tracking
    ) events
  ) shipping ON TRUE
), shipping_only AS (
  SELECT "candidateId"
  FROM snapshots
  GROUP BY "candidateId"
  HAVING count(DISTINCT "shipments") > 1
    AND count(DISTINCT "materialPayload") = 1
    AND count(DISTINCT "orderedAt") = 1
), ranked AS (
  SELECT snapshots.*,
    row_number() OVER (PARTITION BY snapshots."candidateId"
      ORDER BY snapshots."orderTime" DESC, snapshots."cancelled" DESC,
        snapshots."shippingTime" DESC NULLS LAST,
        snapshots."payloadHash" DESC, snapshots."evidenceId" DESC) AS "rank"
  FROM snapshots
  JOIN shipping_only ON shipping_only."candidateId" = snapshots."candidateId"
), latest AS (
  SELECT * FROM ranked WHERE "rank" = 1
)
SELECT ranked."candidateId", ranked."evidenceId",
  latest."evidenceId" AS "latestEvidenceId",
  ranked."shipments" IS DISTINCT FROM latest."shipments" AS "different"
FROM ranked
JOIN latest ON latest."candidateId" = ranked."candidateId";

UPDATE "BuyerPurchaseCandidate" candidate
SET "currentEvidenceId" = repair."latestEvidenceId",
  "status" = 'COM_DIVERGENCIA'::"EstadoCandidatoCompra",
  "version" = candidate."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM (SELECT "candidateId", max("latestEvidenceId") AS "latestEvidenceId"
  FROM "_buyer_legacy_shipping" GROUP BY "candidateId") repair
WHERE candidate."id" = repair."candidateId";

UPDATE "BuyerEvidenceLink" link
SET "type" = 'CONFLICTING'::"TipoVinculoEvidenciaCompra"
FROM "_buyer_legacy_shipping" repair
WHERE link."candidateId" = repair."candidateId"
  AND link."evidenceId" = repair."evidenceId"
  AND repair."different";

INSERT INTO "BuyerReconciliationConflict" (
  "id", "candidateId", "referenceEvidenceId", "evidenceId", "type"
)
SELECT 'legacy-shipping-' || md5(repair."candidateId" || ':' || repair."evidenceId"),
  repair."candidateId", repair."latestEvidenceId", repair."evidenceId",
  'SHIPMENTS'::"TipoConflitoEvidenciaCompra"
FROM "_buyer_legacy_shipping" repair
WHERE repair."different"
ON CONFLICT ("candidateId", "evidenceId", "type") DO NOTHING;

COMMIT;
