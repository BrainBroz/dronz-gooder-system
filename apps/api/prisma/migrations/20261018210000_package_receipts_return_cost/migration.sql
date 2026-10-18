-- Auditoria PD: recebimento por pacote e custo de origem do lote de devolução. Sem backfill: vínculos antigos não são inferidos.
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "baixaOrigemId" TEXT;

ALTER TABLE "RecebimentoMiami" ADD COLUMN     "pacoteExternoId" TEXT;

CREATE INDEX "RecebimentoMiami_pacoteExternoId_idx" ON "RecebimentoMiami"("pacoteExternoId");

ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_pacoteExternoId_fkey" FOREIGN KEY ("pacoteExternoId") REFERENCES "PacoteExterno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_baixaOrigemId_fkey" FOREIGN KEY ("baixaOrigemId") REFERENCES "BaixaVenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
