-- CreateTable
CREATE TABLE "LoteLineage" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "parentLoteId" TEXT NOT NULL,
    "childLoteId" TEXT NOT NULL,
    "tipoOperacao" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteLineage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoteLineage_lojaId_parentLoteId_idx" ON "LoteLineage"("lojaId", "parentLoteId");

-- CreateIndex
CREATE INDEX "LoteLineage_lojaId_childLoteId_idx" ON "LoteLineage"("lojaId", "childLoteId");

-- AddForeignKey
ALTER TABLE "LoteLineage" ADD CONSTRAINT "LoteLineage_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteLineage" ADD CONSTRAINT "LoteLineage_parentLoteId_fkey" FOREIGN KEY ("parentLoteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoteLineage" ADD CONSTRAINT "LoteLineage_childLoteId_fkey" FOREIGN KEY ("childLoteId") REFERENCES "Lote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
