CREATE TYPE "MarketplaceProvider" AS ENUM ('AMAZON', 'EBAY');
CREATE TYPE "EscopoConexaoMarketplace" AS ENUM ('SHARED', 'STORE_DEDICATED');
CREATE TYPE "StatusConexaoMarketplace" AS ENUM ('NOT_CONFIGURED', 'ACTIVE', 'INACTIVE', 'AUTHORIZATION_EXPIRED', 'ERROR');
CREATE TYPE "StatusExecucaoSincronizacao" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED');
CREATE TYPE "OrigemExecucaoSincronizacao" AS ENUM ('MANUAL', 'REPLAY', 'SCHEDULED');
CREATE TYPE "OrigemTrackingExterno" AS ENUM ('MARKETPLACE', 'MANUAL');

CREATE TABLE "ConexaoMarketplace" (
  "id" TEXT NOT NULL,
  "provider" "MarketplaceProvider" NOT NULL,
  "contaExternaId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "identificadorExterno" TEXT NOT NULL,
  "regiao" TEXT,
  "marketplace" TEXT,
  "escopo" "EscopoConexaoMarketplace" NOT NULL,
  "lojaPermitidaId" TEXT,
  "secretReference" TEXT,
  "status" "StatusConexaoMarketplace" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "autorizadoEm" TIMESTAMP(3),
  "autorizacaoExpiraEm" TIMESTAMP(3),
  "ultimaSincronizacaoEm" TIMESTAMP(3),
  "cursorSincronizacao" TEXT,
  "ultimoErroSanitizado" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "criadoPorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConexaoMarketplace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConexaoMarketplace_scope_check" CHECK (
    ("escopo" = 'SHARED' AND "lojaPermitidaId" IS NULL)
    OR ("escopo" = 'STORE_DEDICATED' AND "lojaPermitidaId" IS NOT NULL)
  ),
  CONSTRAINT "ConexaoMarketplace_version_check" CHECK ("version" > 0)
);

CREATE TABLE "ExecucaoSincronizacao" (
  "id" TEXT NOT NULL,
  "conexaoId" TEXT NOT NULL,
  "status" "StatusExecucaoSincronizacao" NOT NULL DEFAULT 'PENDING',
  "origem" "OrigemExecucaoSincronizacao" NOT NULL,
  "cursorInicial" TEXT,
  "cursorFinal" TEXT,
  "janelaInicio" TIMESTAMP(3),
  "janelaFim" TIMESTAMP(3),
  "processados" INTEGER NOT NULL DEFAULT 0,
  "criados" INTEGER NOT NULL DEFAULT 0,
  "atualizados" INTEGER NOT NULL DEFAULT 0,
  "ignorados" INTEGER NOT NULL DEFAULT 0,
  "conflitos" INTEGER NOT NULL DEFAULT 0,
  "falhas" INTEGER NOT NULL DEFAULT 0,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "erroSanitizado" TEXT,
  "iniciadoEm" TIMESTAMP(3),
  "finalizadoEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExecucaoSincronizacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecucaoSincronizacao_counts_check" CHECK (
    "processados" >= 0 AND "criados" >= 0 AND "atualizados" >= 0
    AND "ignorados" >= 0 AND "conflitos" >= 0 AND "falhas" >= 0
  )
);

ALTER TABLE "CompraImportada" ADD COLUMN "conexaoMarketplaceId" TEXT;

CREATE TABLE "EnvioExterno" (
  "id" TEXT NOT NULL,
  "compraImportadaId" TEXT NOT NULL,
  "externalShipmentId" TEXT NOT NULL,
  "statusExterno" TEXT,
  "enviadoEm" TIMESTAMP(3),
  "ultimaAtualizacaoEm" TIMESTAMP(3) NOT NULL,
  "payloadSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnvioExterno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PacoteExterno" (
  "id" TEXT NOT NULL,
  "envioExternoId" TEXT NOT NULL,
  "externalPackageId" TEXT NOT NULL,
  "transportadora" TEXT,
  "payloadSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PacoteExterno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackingExterno" (
  "id" TEXT NOT NULL,
  "pacoteExternoId" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "transportadora" TEXT,
  "origem" "OrigemTrackingExterno" NOT NULL DEFAULT 'MARKETPLACE',
  "statusExterno" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "substituiTrackingId" TEXT,
  "criadoExternamenteEm" TIMESTAMP(3),
  "ultimaAtualizacaoEm" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrackingExterno_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrackingExterno_codigo_check" CHECK (length(trim("codigo")) > 0)
);

CREATE TABLE "EventoTrackingExterno" (
  "id" TEXT NOT NULL,
  "trackingExternoId" TEXT NOT NULL,
  "externalEventId" TEXT,
  "statusExterno" TEXT NOT NULL,
  "ocorridoEm" TIMESTAMP(3) NOT NULL,
  "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadSnapshot" JSONB,
  CONSTRAINT "EventoTrackingExterno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConexaoMarketplace_provider_identificadorExterno_key" ON "ConexaoMarketplace"("provider", "identificadorExterno");
CREATE UNIQUE INDEX "ConexaoMarketplace_contaExternaId_key" ON "ConexaoMarketplace"("contaExternaId");
CREATE INDEX "ConexaoMarketplace_provider_status_idx" ON "ConexaoMarketplace"("provider", "status");
CREATE INDEX "ConexaoMarketplace_escopo_lojaPermitidaId_idx" ON "ConexaoMarketplace"("escopo", "lojaPermitidaId");
CREATE UNIQUE INDEX "ExecucaoSincronizacao_correlationId_key" ON "ExecucaoSincronizacao"("correlationId");
CREATE UNIQUE INDEX "ExecucaoSincronizacao_conexaoId_idempotencyKey_key" ON "ExecucaoSincronizacao"("conexaoId", "idempotencyKey");
CREATE UNIQUE INDEX "ExecucaoSincronizacao_running_key" ON "ExecucaoSincronizacao"("conexaoId") WHERE "status" = 'RUNNING';
CREATE INDEX "ExecucaoSincronizacao_conexaoId_createdAt_idx" ON "ExecucaoSincronizacao"("conexaoId", "createdAt");
CREATE INDEX "ExecucaoSincronizacao_status_createdAt_idx" ON "ExecucaoSincronizacao"("status", "createdAt");
CREATE INDEX "CompraImportada_conexaoMarketplaceId_ultimaSincronizacaoEm_idx" ON "CompraImportada"("conexaoMarketplaceId", "ultimaSincronizacaoEm");
CREATE UNIQUE INDEX "EnvioExterno_compraImportadaId_externalShipmentId_key" ON "EnvioExterno"("compraImportadaId", "externalShipmentId");
CREATE INDEX "EnvioExterno_compraImportadaId_ultimaAtualizacaoEm_idx" ON "EnvioExterno"("compraImportadaId", "ultimaAtualizacaoEm");
CREATE UNIQUE INDEX "PacoteExterno_envioExternoId_externalPackageId_key" ON "PacoteExterno"("envioExternoId", "externalPackageId");
CREATE INDEX "PacoteExterno_envioExternoId_idx" ON "PacoteExterno"("envioExternoId");
CREATE UNIQUE INDEX "TrackingExterno_package_code_carrier_key" ON "TrackingExterno"("pacoteExternoId", "codigo", COALESCE("transportadora", ''));
CREATE INDEX "TrackingExterno_pacoteExternoId_codigo_idx" ON "TrackingExterno"("pacoteExternoId", "codigo");
CREATE INDEX "TrackingExterno_codigo_idx" ON "TrackingExterno"("codigo");
CREATE INDEX "TrackingExterno_pacoteExternoId_ativo_idx" ON "TrackingExterno"("pacoteExternoId", "ativo");
CREATE UNIQUE INDEX "EventoTrackingExterno_trackingExternoId_externalEventId_key" ON "EventoTrackingExterno"("trackingExternoId", "externalEventId");
CREATE INDEX "EventoTrackingExterno_trackingExternoId_ocorridoEm_idx" ON "EventoTrackingExterno"("trackingExternoId", "ocorridoEm");

ALTER TABLE "ConexaoMarketplace" ADD CONSTRAINT "ConexaoMarketplace_contaExternaId_fkey" FOREIGN KEY ("contaExternaId") REFERENCES "ContaExterna"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConexaoMarketplace" ADD CONSTRAINT "ConexaoMarketplace_lojaPermitidaId_fkey" FOREIGN KEY ("lojaPermitidaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConexaoMarketplace" ADD CONSTRAINT "ConexaoMarketplace_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecucaoSincronizacao" ADD CONSTRAINT "ExecucaoSincronizacao_conexaoId_fkey" FOREIGN KEY ("conexaoId") REFERENCES "ConexaoMarketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompraImportada" ADD CONSTRAINT "CompraImportada_conexaoMarketplaceId_fkey" FOREIGN KEY ("conexaoMarketplaceId") REFERENCES "ConexaoMarketplace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnvioExterno" ADD CONSTRAINT "EnvioExterno_compraImportadaId_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PacoteExterno" ADD CONSTRAINT "PacoteExterno_envioExternoId_fkey" FOREIGN KEY ("envioExternoId") REFERENCES "EnvioExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackingExterno" ADD CONSTRAINT "TrackingExterno_pacoteExternoId_fkey" FOREIGN KEY ("pacoteExternoId") REFERENCES "PacoteExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrackingExterno" ADD CONSTRAINT "TrackingExterno_substituiTrackingId_fkey" FOREIGN KEY ("substituiTrackingId") REFERENCES "TrackingExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoTrackingExterno" ADD CONSTRAINT "EventoTrackingExterno_trackingExternoId_fkey" FOREIGN KEY ("trackingExternoId") REFERENCES "TrackingExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
