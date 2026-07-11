-- CreateEnum
CREATE TYPE "ContaPatrimonial" AS ENUM ('EXTERNAL_SUPPLIER', 'OWNED_IN_TRANSIT', 'OWNED_AT_LOCATION', 'QUARANTINE', 'SELLABLE', 'RESERVED', 'RETURN_IN_TRANSIT', 'SOLD', 'LOST', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "MovimentoPatrimonialTipo" AS ENUM ('INCORPORATION', 'INCORPORATION_CANCEL', 'TRANSFER', 'RESERVE', 'RESERVE_RELEASE', 'SALE_SETTLEMENT', 'RETURN_RECEIPT', 'RETURN_CONFERENCE', 'LOSS', 'LOSS_RECOVERY', 'ADJUSTMENT_POSITIVE', 'ADJUSTMENT_NEGATIVE', 'LOTE_SPLIT', 'LOTE_MERGE', 'ADMIN_REVERSAL', 'OPENING_BACKFILL');

-- CreateEnum
CREATE TYPE "LoteLifecycleStatus" AS ENUM ('ACTIVE', 'CLOSED_SPLIT', 'CLOSED_MERGED');

-- CreateEnum
CREATE TYPE "LoteCostStatus" AS ENUM ('KNOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LoteCondicao" AS ENUM ('UNKNOWN', 'NEW', 'NEW_IN_NAME_OF_THIRD_PARTY', 'USED', 'USED_NO_CABLES', 'OPEN_BOX');

-- CreateEnum
CREATE TYPE "LoteOrigem" AS ENUM ('PURCHASE_ORDER', 'OPENING_BALANCE', 'SPLIT', 'MERGE', 'RETURN');

-- CreateEnum
CREATE TYPE "LocalizacaoTipo" AS ENUM ('WAREHOUSE', 'TRAVELER_ADDRESS', 'HOTEL', 'OFFICE', 'STORE', 'TRANSIT_HUB', 'PARAGUAY_HUB', 'CUSTOMER', 'OTHER');

-- AlterTable
-- AuditLog precisa de lojaId desde já: executarMovimento (ledger.service.ts)
-- grava auditoria por loja na mesma transação do movimento (§12/§17).
ALTER TABLE "AuditLog" ADD COLUMN     "lojaId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_lojaId_createdAt_idx" ON "AuditLog"("lojaId", "createdAt");

-- CreateTable
CREATE TABLE "Localizacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "LocalizacaoTipo" NOT NULL,
    "timezone" TEXT NOT NULL,
    "pais" TEXT,
    "estado" TEXT,
    "cidade" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ownerLojaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Localizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "origem" "LoteOrigem" NOT NULL,
    "pedidoCompraItemId" TEXT,
    "condicao" "LoteCondicao" NOT NULL DEFAULT 'UNKNOWN',
    "costStatus" "LoteCostStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lifecycleStatus" "LoteLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "moedaOriginal" TEXT,
    "valorUnitarioOriginal" DECIMAL(12,2),
    "cotacaoReferencia" DECIMAL(18,6),
    "ajusteCambio" DECIMAL(18,6),
    "cotacaoAplicada" DECIMAL(18,6),
    "custoUnitarioUsd" DECIMAL(12,2),
    "incorporadoEm" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByMovimentoId" TEXT,
    "legacyEntity" TEXT,
    "legacyId" TEXT,
    "migrationVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoPatrimonial" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "tipo" "MovimentoPatrimonialTipo" NOT NULL,
    "realizadoPorId" TEXT NOT NULL,
    "observacoes" TEXT,
    "compensaMovimentoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoPatrimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoPatrimonial" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "movimentoId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "conta" "ContaPatrimonial" NOT NULL,
    "localizacaoId" TEXT,
    "quantidadeDelta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LancamentoPatrimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaldoLoteLocalizacao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "conta" "ContaPatrimonial" NOT NULL,
    "localizacaoId" TEXT,
    "saldo" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaldoLoteLocalizacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Localizacao_tipo_ativo_idx" ON "Localizacao"("tipo", "ativo");

-- CreateIndex
CREATE INDEX "Localizacao_ownerLojaId_idx" ON "Localizacao"("ownerLojaId");

-- CreateIndex
CREATE INDEX "Lote_lojaId_produtoId_idx" ON "Lote"("lojaId", "produtoId");

-- CreateIndex
CREATE INDEX "Lote_lojaId_lifecycleStatus_idx" ON "Lote"("lojaId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "Lote_lojaId_pedidoCompraItemId_idx" ON "Lote"("lojaId", "pedidoCompraItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_id_lojaId_key" ON "Lote"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_legacyEntity_legacyId_migrationVersion_key" ON "Lote"("legacyEntity", "legacyId", "migrationVersion");

-- CreateIndex
CREATE INDEX "MovimentoPatrimonial_lojaId_createdAt_idx" ON "MovimentoPatrimonial"("lojaId", "createdAt");

-- CreateIndex
CREATE INDEX "MovimentoPatrimonial_lojaId_tipo_idx" ON "MovimentoPatrimonial"("lojaId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoPatrimonial_id_lojaId_key" ON "MovimentoPatrimonial"("id", "lojaId");

-- CreateIndex
CREATE INDEX "LancamentoPatrimonial_lojaId_loteId_createdAt_id_idx" ON "LancamentoPatrimonial"("lojaId", "loteId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LancamentoPatrimonial_lojaId_produtoId_createdAt_idx" ON "LancamentoPatrimonial"("lojaId", "produtoId", "createdAt");

-- CreateIndex
CREATE INDEX "LancamentoPatrimonial_movimentoId_idx" ON "LancamentoPatrimonial"("movimentoId");

-- CreateIndex
CREATE INDEX "SaldoLoteLocalizacao_lojaId_produtoId_conta_idx" ON "SaldoLoteLocalizacao"("lojaId", "produtoId", "conta");

-- CreateIndex
CREATE INDEX "SaldoLoteLocalizacao_lojaId_localizacaoId_conta_idx" ON "SaldoLoteLocalizacao"("lojaId", "localizacaoId", "conta");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoLoteLocalizacao_lojaId_loteId_conta_localizacaoId_key" ON "SaldoLoteLocalizacao"("lojaId", "loteId", "conta", "localizacaoId");

-- AddForeignKey
ALTER TABLE "Localizacao" ADD CONSTRAINT "Localizacao_ownerLojaId_fkey" FOREIGN KEY ("ownerLojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_closedByMovimentoId_lojaId_fkey" FOREIGN KEY ("closedByMovimentoId", "lojaId") REFERENCES "MovimentoPatrimonial"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoPatrimonial" ADD CONSTRAINT "MovimentoPatrimonial_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoPatrimonial" ADD CONSTRAINT "MovimentoPatrimonial_realizadoPorId_fkey" FOREIGN KEY ("realizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoPatrimonial" ADD CONSTRAINT "MovimentoPatrimonial_compensaMovimentoId_lojaId_fkey" FOREIGN KEY ("compensaMovimentoId", "lojaId") REFERENCES "MovimentoPatrimonial"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoPatrimonial" ADD CONSTRAINT "LancamentoPatrimonial_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoPatrimonial" ADD CONSTRAINT "LancamentoPatrimonial_movimentoId_lojaId_fkey" FOREIGN KEY ("movimentoId", "lojaId") REFERENCES "MovimentoPatrimonial"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoPatrimonial" ADD CONSTRAINT "LancamentoPatrimonial_loteId_lojaId_fkey" FOREIGN KEY ("loteId", "lojaId") REFERENCES "Lote"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoPatrimonial" ADD CONSTRAINT "LancamentoPatrimonial_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoPatrimonial" ADD CONSTRAINT "LancamentoPatrimonial_localizacaoId_fkey" FOREIGN KEY ("localizacaoId") REFERENCES "Localizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoLoteLocalizacao" ADD CONSTRAINT "SaldoLoteLocalizacao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoLoteLocalizacao" ADD CONSTRAINT "SaldoLoteLocalizacao_loteId_lojaId_fkey" FOREIGN KEY ("loteId", "lojaId") REFERENCES "Lote"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoLoteLocalizacao" ADD CONSTRAINT "SaldoLoteLocalizacao_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaldoLoteLocalizacao" ADD CONSTRAINT "SaldoLoteLocalizacao_localizacaoId_fkey" FOREIGN KEY ("localizacaoId") REFERENCES "Localizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integridade do ledger (ARQUITETURA_OPERACIONAL_V2 §5.1, §5.2) ───────────

-- Lançamento nunca tem delta zero: toda linha é um débito ou um crédito real.
ALTER TABLE "LancamentoPatrimonial"
  ADD CONSTRAINT "LancamentoPatrimonial_quantidadeDelta_nonzero"
  CHECK ("quantidadeDelta" <> 0);

-- Domínios de saldo por conta (§5.1):
--   EXTERNAL_SUPPLIER <= 0; WRITTEN_OFF assinado (livre); demais >= 0.
ALTER TABLE "SaldoLoteLocalizacao"
  ADD CONSTRAINT "SaldoLoteLocalizacao_saldo_domain"
  CHECK (
    ("conta" = 'WRITTEN_OFF')
    OR ("conta" = 'EXTERNAL_SUPPLIER' AND "saldo" <= 0)
    OR ("conta" NOT IN ('WRITTEN_OFF', 'EXTERNAL_SUPPLIER') AND "saldo" >= 0)
  );

-- Unicidade da projeção quando a conta não possui localização física
-- (contas terminais/fronteira): complementa o unique composto, já que o
-- PostgreSQL trata NULLs como distintos em índices únicos.
CREATE UNIQUE INDEX "SaldoLoteLocalizacao_null_localizacao_uniq"
  ON "SaldoLoteLocalizacao" ("lojaId", "loteId", "conta")
  WHERE "localizacaoId" IS NULL;
