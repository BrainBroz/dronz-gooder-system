ALTER TABLE "Viagem"
  ADD COLUMN "rotaCodigo" TEXT NOT NULL DEFAULT 'LEGACY_MIAMI_PARAGUAI_BRASIL',
  ADD COLUMN "rotaVersao" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "checkpointsObrigatorios" TEXT[] NOT NULL DEFAULT ARRAY['MIAMI', 'PARAGUAI', 'BRASIL', 'RECEBIMENTO', 'ENTRADA_DEFINITIVA']::TEXT[];

ALTER TABLE "AuditLog"
  ADD COLUMN "lojaId" TEXT,
  ADD COLUMN "permissionCode" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "beforeData" JSONB,
  ADD COLUMN "afterData" JSONB,
  ADD COLUMN "origin" TEXT;

ALTER TABLE "MovimentacaoEstoque" ADD COLUMN "movimentoOriginalId" TEXT;
ALTER TABLE "CheckpointParaguai" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "CheckpointBrasil" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "EstoqueEntrada" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "Recebimento" ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "lojaId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventoCorretivo" (
  "id" TEXT NOT NULL,
  "lojaId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "originalEventId" TEXT NOT NULL,
  "correctionType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeData" JSONB NOT NULL,
  "afterData" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "permissionCode" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventoCorretivo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventoCorretivo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_lojaId_createdAt_idx" ON "AuditLog"("lojaId", "createdAt");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");
CREATE INDEX "MovimentacaoEstoque_movimentoOriginalId_idx" ON "MovimentacaoEstoque"("movimentoOriginalId");
CREATE UNIQUE INDEX "IdempotencyRecord_lojaId_operation_entityId_idempotencyKey_key" ON "IdempotencyRecord"("lojaId", "operation", "entityId", "idempotencyKey");
CREATE INDEX "IdempotencyRecord_lojaId_createdAt_idx" ON "IdempotencyRecord"("lojaId", "createdAt");
CREATE INDEX "EventoCorretivo_lojaId_entity_entityId_createdAt_idx" ON "EventoCorretivo"("lojaId", "entity", "entityId", "createdAt");
CREATE INDEX "EventoCorretivo_originalEventId_idx" ON "EventoCorretivo"("originalEventId");
CREATE INDEX "EventoCorretivo_correlationId_idx" ON "EventoCorretivo"("correlationId");

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "lojaId", "viagemId", "malaId" ORDER BY "createdAt", "id") AS row_number
  FROM "CheckpointParaguai"
)
UPDATE "CheckpointParaguai" SET "supersededAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "lojaId", "viagemId", "malaId" ORDER BY "createdAt", "id") AS row_number
  FROM "CheckpointBrasil"
)
UPDATE "CheckpointBrasil" SET "supersededAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "lojaId", "viagemId", "malaId" ORDER BY ("status" = 'COMPLETED') DESC, "createdAt", "id") AS row_number
  FROM "EstoqueEntrada"
)
UPDATE "EstoqueEntrada" SET "supersededAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "CheckpointParaguai_active_route_key" ON "CheckpointParaguai"("lojaId", "viagemId", "malaId") WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "CheckpointBrasil_active_route_key" ON "CheckpointBrasil"("lojaId", "viagemId", "malaId") WHERE "supersededAt" IS NULL;
CREATE UNIQUE INDEX "EstoqueEntrada_active_route_key" ON "EstoqueEntrada"("lojaId", "viagemId", "malaId") WHERE "supersededAt" IS NULL;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "lojaId", "viagemId", "malaId" ORDER BY ("status" = 'COMPLETED') DESC, "createdAt", "id") AS row_number
  FROM "Recebimento"
)
UPDATE "Recebimento" SET "supersededAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "Recebimento_active_route_key" ON "Recebimento"("lojaId", "viagemId", "malaId") WHERE "supersededAt" IS NULL;
