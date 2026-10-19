-- Auditoria PD: recebimento por pacote e custo de origem do lote de devolução. Sem backfill: vínculos antigos não são inferidos.
-- A baixa de origem é referenciada por [id, lojaId] (tenant-safe).
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "baixaOrigemId" TEXT;

ALTER TABLE "RecebimentoMiami" ADD COLUMN     "atribuicaoPacoteConhecida" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pacoteExternoId" TEXT;

CREATE UNIQUE INDEX "BaixaVenda_id_lojaId_key" ON "BaixaVenda"("id", "lojaId");

CREATE INDEX "RecebimentoMiami_pacoteExternoId_idx" ON "RecebimentoMiami"("pacoteExternoId");

ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_pacoteExternoId_fkey" FOREIGN KEY ("pacoteExternoId") REFERENCES "PacoteExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_baixaOrigemId_lojaId_fkey" FOREIGN KEY ("baixaOrigemId", "lojaId") REFERENCES "BaixaVenda"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
