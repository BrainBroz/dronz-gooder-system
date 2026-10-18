-- CreateTable
CREATE TABLE "ReconciliacaoLote" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "movimentoEntradaId" TEXT NOT NULL,
    "movimentoSaidaId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliacaoLote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliacaoLote_lojaId_movimentoEntradaId_idx" ON "ReconciliacaoLote"("lojaId", "movimentoEntradaId");

-- CreateIndex
CREATE INDEX "ReconciliacaoLote_movimentoSaidaId_idx" ON "ReconciliacaoLote"("movimentoSaidaId");

-- AddForeignKey
ALTER TABLE "ReconciliacaoLote" ADD CONSTRAINT "ReconciliacaoLote_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliacaoLote" ADD CONSTRAINT "ReconciliacaoLote_movimentoEntradaId_lojaId_fkey" FOREIGN KEY ("movimentoEntradaId", "lojaId") REFERENCES "MovimentacaoEstoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliacaoLote" ADD CONSTRAINT "ReconciliacaoLote_movimentoSaidaId_lojaId_fkey" FOREIGN KEY ("movimentoSaidaId", "lojaId") REFERENCES "MovimentacaoEstoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ReconciliacaoLote" ADD CONSTRAINT "ReconciliacaoLote_quantidade_check" CHECK ("quantidade" > 0);
