CREATE TYPE "FonteEvidenciaCompra" AS ENUM (
  'AMAZON_BUSINESS_API', 'EBAY_BUYER_API', 'EMAIL_AMAZON', 'EMAIL_EBAY',
  'EMAIL_OUTRO', 'INVOICE', 'DOCUMENTO', 'CSV', 'MANUAL'
);

CREATE TYPE "ClassificacaoEvidenciaCompra" AS ENUM ('DADOS_COMERCIAIS_NORMALIZADOS');

CREATE TABLE "BuyerEvidence" (
  "id" TEXT NOT NULL,
  "source" "FonteEvidenciaCompra" NOT NULL,
  "sourceIdentity" TEXT NOT NULL,
  "externalEvidenceId" TEXT NOT NULL,
  "externalOrderIdNormalized" TEXT,
  "contaExternaId" TEXT,
  "conexaoMarketplaceId" TEXT,
  "sourceOccurredAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "dataClassification" "ClassificacaoEvidenciaCompra" NOT NULL DEFAULT 'DADOS_COMERCIAIS_NORMALIZADOS',
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuyerEvidence_version_check" CHECK ("version" > 0),
  CONSTRAINT "BuyerEvidence_hash_check" CHECK (length("payloadHash") = 64)
);

CREATE TABLE "BuyerEvidenceItem" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "externalLineId" TEXT,
  "identityFingerprint" TEXT NOT NULL,
  "identityDiscriminator" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "variation" TEXT,
  "sku" TEXT,
  "asin" TEXT,
  "offerId" TEXT,
  "quantity" INTEGER NOT NULL,
  "cancelledQuantity" INTEGER NOT NULL,
  "refundedQuantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL,
  CONSTRAINT "BuyerEvidenceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuyerEvidenceItem_quantity_check" CHECK (
    "quantity" > 0 AND "cancelledQuantity" >= 0 AND "refundedQuantity" >= 0
    AND "cancelledQuantity" + "refundedQuantity" <= "quantity"
  ),
  CONSTRAINT "BuyerEvidenceItem_discriminator_check" CHECK ("identityDiscriminator" >= 0)
);

CREATE UNIQUE INDEX "BuyerEvidence_sourceIdentity_externalEvidenceId_payloadHash_key"
  ON "BuyerEvidence"("sourceIdentity", "externalEvidenceId", "payloadHash");
CREATE UNIQUE INDEX "BuyerEvidence_sourceIdentity_externalEvidenceId_version_key"
  ON "BuyerEvidence"("sourceIdentity", "externalEvidenceId", "version");
CREATE INDEX "BuyerEvidence_source_externalOrderIdNormalized_createdAt_idx"
  ON "BuyerEvidence"("source", "externalOrderIdNormalized", "createdAt");
CREATE INDEX "BuyerEvidence_contaExternaId_createdAt_idx"
  ON "BuyerEvidence"("contaExternaId", "createdAt");
CREATE INDEX "BuyerEvidence_conexaoMarketplaceId_createdAt_idx"
  ON "BuyerEvidence"("conexaoMarketplaceId", "createdAt");
CREATE UNIQUE INDEX "BuyerEvidenceItem_evidenceId_identityFingerprint_identityDiscriminator_key"
  ON "BuyerEvidenceItem"("evidenceId", "identityFingerprint", "identityDiscriminator");
CREATE INDEX "BuyerEvidenceItem_externalLineId_idx" ON "BuyerEvidenceItem"("externalLineId");

ALTER TABLE "BuyerEvidence" ADD CONSTRAINT "BuyerEvidence_contaExternaId_fkey"
  FOREIGN KEY ("contaExternaId") REFERENCES "ContaExterna"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerEvidence" ADD CONSTRAINT "BuyerEvidence_conexaoMarketplaceId_fkey"
  FOREIGN KEY ("conexaoMarketplaceId") REFERENCES "ConexaoMarketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuyerEvidenceItem" ADD CONSTRAINT "BuyerEvidenceItem_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "BuyerEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
