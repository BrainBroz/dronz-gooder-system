CREATE TYPE "TipoCorrecaoOperacional" AS ENUM ('DIVERGENCIA', 'AJUSTE_RECEBIMENTO', 'STOCK_COMPENSATION');
CREATE TYPE "TipoDivergenciaRecebimento" AS ENUM ('CORRETO', 'FALTA', 'EXCESSO', 'AVARIA', 'ITEM_INCORRETO', 'OUTRO');

UPDATE "EventoCorretivo" SET "correctionType" = 'DIVERGENCIA' WHERE "correctionType" = 'DIVERGENCE';

ALTER TABLE "EventoCorretivo"
  ALTER COLUMN "correctionType" TYPE "TipoCorrecaoOperacional"
  USING "correctionType"::"TipoCorrecaoOperacional";

ALTER TABLE "RecebimentoItem"
  ADD COLUMN "tipoDivergencia" "TipoDivergenciaRecebimento" NOT NULL DEFAULT 'CORRETO',
  ADD COLUMN "divergenciaResolvida" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE "ProjecaoOperacional" (
  "id" TEXT NOT NULL,
  "lojaId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjecaoOperacional_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjecaoOperacional_lojaId_entity_entityId_key" ON "ProjecaoOperacional"("lojaId", "entity", "entityId");
CREATE INDEX "ProjecaoOperacional_lojaId_entity_updatedAt_idx" ON "ProjecaoOperacional"("lojaId", "entity", "updatedAt");

CREATE UNIQUE INDEX "MovimentacaoEstoque_id_lojaId_key" ON "MovimentacaoEstoque"("id", "lojaId");
ALTER TABLE "MovimentacaoEstoque"
  ADD CONSTRAINT "MovimentacaoEstoque_original_not_self" CHECK ("movimentoOriginalId" IS NULL OR "movimentoOriginalId" <> "id"),
  ADD CONSTRAINT "MovimentacaoEstoque_movimentoOriginalId_lojaId_fkey"
    FOREIGN KEY ("movimentoOriginalId", "lojaId") REFERENCES "MovimentacaoEstoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconciles legacy PURCHASE_RECEIPT entries created both during item confirmation
-- and definitive entry. The authoritative incorporated quantity is the physically
-- accepted quantity per receiving item. History is preserved through a compensating
-- movement; no prior movement is deleted or rewritten.
DO $$
DECLARE
  repair RECORD;
  new_physical INTEGER;
BEGIN
  FOR repair IN
    WITH expected AS (
      SELECT ri."recebimentoId", ri."produtoId", ri."lojaId",
             SUM(GREATEST(0, ri."quantidadeRecebida" - ri."quantidadeRejeitada"))::INTEGER AS accepted_quantity
      FROM "RecebimentoItem" ri
      GROUP BY ri."recebimentoId", ri."produtoId", ri."lojaId"
    ), posted AS (
      SELECT me."recebimentoId", me."produtoId", me."lojaId",
             SUM(me."quantidade")::INTEGER AS posted_quantity,
             (ARRAY_AGG(me."id" ORDER BY me."createdAt" DESC, me."id" DESC))[1] AS original_movement_id,
             (ARRAY_AGG(me."responsavelId" ORDER BY me."createdAt" DESC, me."id" DESC))[1] AS responsible_id,
             (ARRAY_AGG(me."estoqueId" ORDER BY me."createdAt" DESC, me."id" DESC))[1] AS stock_id
      FROM "MovimentacaoEstoque" me
      WHERE me."tipo" = 'ENTRY' AND me."motivo" = 'PURCHASE_RECEIPT' AND me."recebimentoId" IS NOT NULL
      GROUP BY me."recebimentoId", me."produtoId", me."lojaId"
    )
    SELECT p.*, e.accepted_quantity, p.posted_quantity - e.accepted_quantity AS excess_quantity
    FROM posted p
    JOIN expected e USING ("recebimentoId", "produtoId", "lojaId")
    WHERE p.posted_quantity > e.accepted_quantity
  LOOP
    SELECT "quantidadeFisica" - repair.excess_quantity INTO new_physical
    FROM "Estoque" WHERE "id" = repair.stock_id FOR UPDATE;

    IF new_physical < 0 OR new_physical < (SELECT "quantidadeReservada" FROM "Estoque" WHERE "id" = repair.stock_id) THEN
      RAISE EXCEPTION 'UI3C_RECONCILIATION_UNSAFE stock=% excess=%', repair.stock_id, repair.excess_quantity;
    END IF;

    UPDATE "Estoque" SET "quantidadeFisica" = new_physical, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = repair.stock_id;

    INSERT INTO "MovimentacaoEstoque" (
      "id", "lojaId", "produtoId", "estoqueId", "recebimentoId", "tipo", "motivo",
      "quantidade", "quantidadeAnterior", "quantidadePosterior", "responsavelId",
      "observacoes", "movimentoOriginalId", "createdAt"
    ) VALUES (
      'repair-ui3c-' || md5(repair."lojaId" || repair."recebimentoId" || repair."produtoId"),
      repair."lojaId", repair."produtoId", repair.stock_id, repair."recebimentoId",
      'ADJUSTMENT_NEGATIVE', 'MANUAL_CORRECTION', repair.excess_quantity,
      new_physical + repair.excess_quantity, new_physical, repair.responsible_id,
      'Reconciliação auditável de ENTRY duplicada anterior ao UI-3C', repair.original_movement_id, CURRENT_TIMESTAMP
    );
  END LOOP;
END $$;
