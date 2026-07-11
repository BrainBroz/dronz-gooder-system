-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "lojaId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_lojaId_idx" ON "AuditLog"("lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
