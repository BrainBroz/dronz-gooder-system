-- CreateTable AtribuicaoItem
CREATE TABLE "AtribuicaoItem" (
    "id" TEXT NOT NULL,
    "pedidoCompraItemId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "atribuidoPorId" TEXT NOT NULL,
    "atribuidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtribuicaoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtribuicaoItem_pedidoCompraItemId_lojaId_key" ON "AtribuicaoItem"("pedidoCompraItemId", "lojaId");

-- CreateIndex
CREATE INDEX "AtribuicaoItem_lojaId_atribuidoEm_idx" ON "AtribuicaoItem"("lojaId", "atribuidoEm");

-- AddForeignKey
ALTER TABLE "AtribuicaoItem" ADD CONSTRAINT "AtribuicaoItem_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtribuicaoItem" ADD CONSTRAINT "AtribuicaoItem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtribuicaoItem" ADD CONSTRAINT "AtribuicaoItem_atribuidoPorId_fkey" FOREIGN KEY ("atribuidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
