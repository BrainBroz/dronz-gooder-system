-- CreateTable
CREATE TABLE "ProjecaoCompraItem" (
    "id" TEXT NOT NULL,
    "itemExternoId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "produtoBaseId" TEXT,
    "vendaUnitariaBrl" DECIMAL(14,2),
    "pesoKg" DECIMAL(10,3),
    "freteRealUsd" DECIMAL(14,2),
    "atualizadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjecaoCompraItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjecaoCompraItem_lojaId_idx" ON "ProjecaoCompraItem"("lojaId");

-- CreateIndex
CREATE INDEX "ProjecaoCompraItem_produtoBaseId_idx" ON "ProjecaoCompraItem"("produtoBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjecaoCompraItem_itemExternoId_lojaId_key" ON "ProjecaoCompraItem"("itemExternoId", "lojaId");

-- AddForeignKey
ALTER TABLE "ProjecaoCompraItem" ADD CONSTRAINT "ProjecaoCompraItem_itemExternoId_fkey" FOREIGN KEY ("itemExternoId") REFERENCES "CompraImportadaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjecaoCompraItem" ADD CONSTRAINT "ProjecaoCompraItem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjecaoCompraItem" ADD CONSTRAINT "ProjecaoCompraItem_produtoBaseId_fkey" FOREIGN KEY ("produtoBaseId") REFERENCES "ProdutoBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjecaoCompraItem" ADD CONSTRAINT "ProjecaoCompraItem_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
