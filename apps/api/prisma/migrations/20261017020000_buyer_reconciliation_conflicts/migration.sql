CREATE TYPE "TipoConflitoEvidenciaCompra" AS ENUM (
  'ORDER_DATE', 'CURRENCY', 'TOTAL', 'MERCHANT', 'ITEMS',
  'QUANTITY', 'INVALID_PRIOR_EVIDENCE', 'LEGACY_UNCLASSIFIED'
);
CREATE TYPE "StatusConflitoEvidenciaCompra" AS ENUM ('ABERTO', 'RESOLVIDO');

CREATE TABLE "BuyerReconciliationConflict" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "referenceEvidenceId" TEXT,
  "evidenceId" TEXT NOT NULL,
  "type" "TipoConflitoEvidenciaCompra" NOT NULL,
  "status" "StatusConflitoEvidenciaCompra" NOT NULL DEFAULT 'ABERTO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerReconciliationConflict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerReconciliationConflict_candidateId_evidenceId_type_key"
  ON "BuyerReconciliationConflict"("candidateId", "evidenceId", "type");
CREATE INDEX "BuyerReconciliationConflict_candidateId_status_createdAt_idx"
  ON "BuyerReconciliationConflict"("candidateId", "status", "createdAt");
CREATE INDEX "BuyerReconciliationConflict_referenceEvidenceId_idx"
  ON "BuyerReconciliationConflict"("referenceEvidenceId");
ALTER TABLE "BuyerReconciliationConflict"
  ADD CONSTRAINT "BuyerReconciliationConflict_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "BuyerPurchaseCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerReconciliationConflict"
  ADD CONSTRAINT "BuyerReconciliationConflict_referenceEvidenceId_fkey"
  FOREIGN KEY ("referenceEvidenceId") REFERENCES "BuyerEvidence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerReconciliationConflict"
  ADD CONSTRAINT "BuyerReconciliationConflict_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "BuyerEvidence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Divergências já registradas como vínculo permanecem abertas sem inferir o tipo.
INSERT INTO "BuyerReconciliationConflict" (
  "id", "candidateId", "evidenceId", "type"
)
SELECT 'legacy-' || md5(link."candidateId" || ':' || link."evidenceId"),
  link."candidateId", link."evidenceId",
  'LEGACY_UNCLASSIFIED'::"TipoConflitoEvidenciaCompra"
FROM "BuyerEvidenceLink" link
WHERE link."type" = 'CONFLICTING';
