#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
DB_NAME="dronz_gooder_buyer_shipping_$$"
DB_URL="postgresql://postgres:postgres@localhost:5432/${DB_NAME}?schema=public"
export PGPASSWORD=postgres

cleanup() {
  dropdb -h localhost -U postgres --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

createdb -h localhost -U postgres "$DB_NAME"
mkdir -p "$TMP/prisma/migrations"
cp "$ROOT/apps/api/prisma/schema.prisma" "$TMP/prisma/schema.prisma"
cp "$ROOT/apps/api/prisma/migrations/migration_lock.toml" "$TMP/prisma/migrations/"
for migration in "$ROOT"/apps/api/prisma/migrations/*; do
  name="$(basename "$migration")"
  if [[ -d "$migration" && "$name" != "20261017027000_repair_legacy_buyer_shipping" ]]; then
    cp -R "$migration" "$TMP/prisma/migrations/$name"
  fi
done
DATABASE_URL="$DB_URL" npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null
DATABASE_URL="$DB_URL" SEED_ADMIN_NAME="Migration Test" SEED_ADMIN_EMAIL="admin@example.com" \
  SEED_ADMIN_PASSWORD="change-me" npx tsx "$ROOT/apps/api/prisma/seed.ts" >/dev/null

psql -h localhost -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "ContaExterna" (
  "id", "plataforma", "identificadorExterno", "nomeExibicao", "origemIntegracao",
  "criadoPorId", "updatedAt"
)
SELECT 'legacy-shipping-account', 'EBAY', 'legacy-shipping-account', 'Legacy Shipping',
  'API', "id", CURRENT_TIMESTAMP
FROM "Usuario" WHERE "email" = 'admin@example.com';

WITH newer AS (
  SELECT '{"externalOrderId":"LEGACY-SHIP","reference":"LEGACY-SHIP","orderedAt":"2026-07-14T10:00:00.000Z","updatedAt":"2026-07-14T11:00:00.000Z","currency":"USD","cancelled":false,"items":[{"externalLineId":"line-1","title":"Item","quantity":1,"cancelledQuantity":0,"refundedQuantity":0,"unitPrice":10,"currency":"USD"}],"shipments":[{"externalShipmentId":"shipment-1","updatedAt":"2026-07-14T13:00:00.000Z","packages":[{"externalPackageId":"package-1","trackings":[{"code":"NEW-CODE","updatedAt":"2026-07-14T13:00:00.000Z"}]}]}]}'::jsonb AS payload
), snapshots AS (
  SELECT 'legacy-shipping-new' AS id, 1 AS version, repeat('a', 64) AS hash,
    payload FROM newer
  UNION ALL
  SELECT 'legacy-shipping-old', 2, repeat('b', 64),
    replace(replace(replace(payload::text, 'NEW-CODE', 'OLD-CODE'),
      '2026-07-14T13:00:00.000Z', '2026-07-14T12:00:00.000Z'),
      '2026-07-14T10:00:00.000Z', '2026-07-14T06:00:00.000-04:00')::jsonb
  FROM newer
)
INSERT INTO "BuyerEvidence" (
  "id", "source", "sourceIdentity", "externalEvidenceId", "externalOrderIdNormalized",
  "contaExternaId", "sourceOccurredAt", "payloadHash", "version",
  "normalizedPayload", "correlationId"
)
SELECT id, 'EBAY_BUYER_API', 'EBAY:legacy-shipping-account', 'LEGACY-SHIP',
  'LEGACY-SHIP', 'legacy-shipping-account', '2026-07-14T11:00:00Z', hash,
  version, payload, id FROM snapshots;

INSERT INTO "BuyerPurchaseCandidate" (
  "id", "provider", "contaExternaId", "externalOrderIdNormalized",
  "currentEvidenceId", "status", "version", "updatedAt"
)
VALUES ('legacy-shipping-candidate', 'EBAY', 'legacy-shipping-account',
  'LEGACY-SHIP', 'legacy-shipping-old', 'AGUARDANDO_APROVACAO', 2, CURRENT_TIMESTAMP);

INSERT INTO "BuyerEvidenceLink" ("id", "candidateId", "evidenceId") VALUES
  ('legacy-shipping-link-new', 'legacy-shipping-candidate', 'legacy-shipping-new'),
  ('legacy-shipping-link-old', 'legacy-shipping-candidate', 'legacy-shipping-old');

INSERT INTO "BuyerEvidence" (
  "id", "source", "sourceIdentity", "externalEvidenceId", "externalOrderIdNormalized",
  "contaExternaId", "sourceOccurredAt", "payloadHash", "version",
  "normalizedPayload", "correlationId"
)
SELECT replace("id", 'legacy-shipping-', 'legacy-protected-'), "source",
  "sourceIdentity", 'LEGACY-PROTECTED', 'LEGACY-PROTECTED', "contaExternaId",
  "sourceOccurredAt", "payloadHash", "version",
  jsonb_set(jsonb_set("normalizedPayload", '{externalOrderId}', '"LEGACY-PROTECTED"'),
    '{reference}', '"LEGACY-PROTECTED"'), replace("id", 'legacy-shipping-', 'legacy-protected-')
FROM "BuyerEvidence" WHERE "id" IN ('legacy-shipping-new', 'legacy-shipping-old');

INSERT INTO "BuyerPurchaseCandidate" (
  "id", "provider", "contaExternaId", "externalOrderIdNormalized",
  "currentEvidenceId", "status", "version", "updatedAt"
)
VALUES ('legacy-protected-candidate', 'EBAY', 'legacy-shipping-account',
  'LEGACY-PROTECTED', 'legacy-protected-old', 'AGUARDANDO_APROVACAO', 2, CURRENT_TIMESTAMP);

INSERT INTO "BuyerEvidenceLink" ("id", "candidateId", "evidenceId") VALUES
  ('legacy-protected-link-new', 'legacy-protected-candidate', 'legacy-protected-new'),
  ('new-ingestion-link-old', 'legacy-protected-candidate', 'legacy-protected-old');
SQL

cp -R "$ROOT/apps/api/prisma/migrations/20261017027000_repair_legacy_buyer_shipping" \
  "$TMP/prisma/migrations/20261017027000_repair_legacy_buyer_shipping"
DATABASE_URL="$DB_URL" npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null

psql -h localhost -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BuyerPurchaseCandidate"
    WHERE "id" = 'legacy-shipping-candidate'
      AND "currentEvidenceId" = 'legacy-shipping-new'
      AND "status" = 'COM_DIVERGENCIA' AND "version" = 3) THEN
    RAISE EXCEPTION 'stale tracking remained approvable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "BuyerEvidenceLink"
    WHERE "candidateId" = 'legacy-shipping-candidate'
      AND "evidenceId" = 'legacy-shipping-old' AND "type" = 'CONFLICTING') THEN
    RAISE EXCEPTION 'stale evidence link was not marked conflicting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "BuyerReconciliationConflict"
    WHERE "candidateId" = 'legacy-shipping-candidate'
      AND "referenceEvidenceId" = 'legacy-shipping-new'
      AND "evidenceId" = 'legacy-shipping-old'
      AND "type" = 'SHIPMENTS' AND "status" = 'ABERTO') THEN
    RAISE EXCEPTION 'shipping conflict was not persisted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "BuyerPurchaseCandidate"
    WHERE "id" = 'legacy-protected-candidate'
      AND "currentEvidenceId" = 'legacy-protected-old'
      AND "status" = 'AGUARDANDO_APROVACAO' AND "version" = 2) THEN
    RAISE EXCEPTION 'nonlegacy candidate was modified';
  END IF;
END $$;
SQL

echo "Buyer shipping migration upgrade test passed"
