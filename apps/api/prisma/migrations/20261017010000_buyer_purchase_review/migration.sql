CREATE TYPE "EstadoCandidatoCompra" AS ENUM (
  'AGUARDANDO_APROVACAO', 'COM_DIVERGENCIA', 'APROVADA', 'REJEITADA', 'CANCELADA'
);
CREATE TYPE "DecisaoCandidatoCompra" AS ENUM ('APROVAR', 'REJEITAR');
CREATE TYPE "TipoVinculoEvidenciaCompra" AS ENUM (
  'MATCHED', 'SUPPORTING', 'CONFLICTING', 'REJECTED'
);

CREATE TABLE "BuyerPurchaseCandidate" (
  "id" TEXT NOT NULL,
  "provider" "MarketplaceProvider" NOT NULL,
  "contaExternaId" TEXT NOT NULL,
  "externalOrderIdNormalized" TEXT NOT NULL,
  "currentEvidenceId" TEXT NOT NULL,
  "status" "EstadoCandidatoCompra" NOT NULL DEFAULT 'AGUARDANDO_APROVACAO',
  "version" INTEGER NOT NULL DEFAULT 1,
  "compraImportadaId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerPurchaseCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerPurchaseCandidate_provider_contaExternaId_order_key"
  ON "BuyerPurchaseCandidate"("provider", "contaExternaId", "externalOrderIdNormalized");
CREATE UNIQUE INDEX "BuyerPurchaseCandidate_compraImportadaId_key"
  ON "BuyerPurchaseCandidate"("compraImportadaId");
CREATE INDEX "BuyerPurchaseCandidate_status_updatedAt_idx"
  ON "BuyerPurchaseCandidate"("status", "updatedAt");
ALTER TABLE "BuyerPurchaseCandidate" ADD CONSTRAINT "BuyerPurchaseCandidate_contaExternaId_fkey"
  FOREIGN KEY ("contaExternaId") REFERENCES "ContaExterna"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerPurchaseCandidate" ADD CONSTRAINT "BuyerPurchaseCandidate_currentEvidenceId_fkey"
  FOREIGN KEY ("currentEvidenceId") REFERENCES "BuyerEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerPurchaseCandidate" ADD CONSTRAINT "BuyerPurchaseCandidate_compraImportadaId_fkey"
  FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BuyerEvidenceLink" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "type" "TipoVinculoEvidenciaCompra" NOT NULL DEFAULT 'MATCHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerEvidenceLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerEvidenceLink_candidateId_evidenceId_key"
  ON "BuyerEvidenceLink"("candidateId", "evidenceId");
CREATE INDEX "BuyerEvidenceLink_evidenceId_idx" ON "BuyerEvidenceLink"("evidenceId");
ALTER TABLE "BuyerEvidenceLink" ADD CONSTRAINT "BuyerEvidenceLink_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "BuyerPurchaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerEvidenceLink" ADD CONSTRAINT "BuyerEvidenceLink_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "BuyerEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BuyerApprovalDecision" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "candidateVersion" INTEGER NOT NULL,
  "decision" "DecisaoCandidatoCompra" NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerApprovalDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerApprovalDecision_candidateId_candidateVersion_key"
  ON "BuyerApprovalDecision"("candidateId", "candidateVersion");
CREATE INDEX "BuyerApprovalDecision_actorId_createdAt_idx"
  ON "BuyerApprovalDecision"("actorId", "createdAt");
ALTER TABLE "BuyerApprovalDecision" ADD CONSTRAINT "BuyerApprovalDecision_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "BuyerPurchaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerApprovalDecision" ADD CONSTRAINT "BuyerApprovalDecision_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "BuyerEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerApprovalDecision" ADD CONSTRAINT "BuyerApprovalDecision_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidências da fundação anterior podem já apontar para compras criadas sem
-- gate humano. Não as classifica como aprovadas nem duplica a compra.
WITH latest AS (
  SELECT DISTINCT ON ("sourceIdentity", "externalEvidenceId")
    "id", "source", "contaExternaId", "externalOrderIdNormalized", "version",
    "sourceIdentity", "externalEvidenceId", "normalizedPayload"
  FROM "BuyerEvidence"
  WHERE "source" IN ('AMAZON_BUSINESS_API', 'EBAY_BUYER_API')
    AND "contaExternaId" IS NOT NULL
    AND "externalOrderIdNormalized" IS NOT NULL
  ORDER BY "sourceIdentity", "externalEvidenceId", "version" DESC
)
INSERT INTO "BuyerPurchaseCandidate" (
  "id", "provider", "contaExternaId", "externalOrderIdNormalized",
  "currentEvidenceId", "status", "version", "compraImportadaId", "updatedAt"
)
SELECT
  'c' || substr(md5(latest."sourceIdentity" || ':' || latest."externalEvidenceId"), 1, 24),
  CASE WHEN latest."source" = 'EBAY_BUYER_API'
    THEN 'EBAY'::"MarketplaceProvider"
    ELSE 'AMAZON'::"MarketplaceProvider" END,
  latest."contaExternaId", latest."externalOrderIdNormalized", latest."id",
  CASE WHEN latest."normalizedPayload"->>'cancelled' = 'true'
    THEN 'CANCELADA'::"EstadoCandidatoCompra"
    ELSE 'AGUARDANDO_APROVACAO'::"EstadoCandidatoCompra" END,
  latest."version",
  purchase."id", CURRENT_TIMESTAMP
FROM latest
LEFT JOIN "CompraImportada" purchase
  ON purchase."contaExternaId" = latest."contaExternaId"
  AND purchase."externalOrderIdNormalizado" = latest."externalOrderIdNormalized"
  AND purchase."plataforma"::text = CASE WHEN latest."source" = 'EBAY_BUYER_API'
    THEN 'EBAY' ELSE 'AMAZON' END;

INSERT INTO "BuyerEvidenceLink" ("id", "candidateId", "evidenceId")
SELECT 'legacy-' || md5(candidate."id" || ':' || evidence."id"),
  candidate."id", evidence."id"
FROM "BuyerEvidence" evidence
JOIN "BuyerPurchaseCandidate" candidate
  ON candidate."contaExternaId" = evidence."contaExternaId"
  AND candidate."externalOrderIdNormalized" = evidence."externalOrderIdNormalized"
  AND candidate."provider"::text = CASE WHEN evidence."source" = 'EBAY_BUYER_API'
    THEN 'EBAY' ELSE 'AMAZON' END
WHERE evidence."source" IN ('AMAZON_BUSINESS_API', 'EBAY_BUYER_API');
