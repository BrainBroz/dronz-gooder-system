-- CreateEnum
CREATE TYPE "StatusAtribuicao" AS ENUM ('PENDENTE_ATRIBUICAO', 'PARCIALMENTE_ATRIBUIDA', 'ATRIBUIDA', 'IGNORADA', 'DUPLICADA');

-- CreateTable CompraImportada
CREATE TABLE "CompraImportada" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT,
    "fornecedorId" TEXT NOT NULL,
    "numeroPedido" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "moeda" TEXT NOT NULL DEFAULT 'USD',
    "statusAtribuicao" "StatusAtribuicao" NOT NULL DEFAULT 'PENDENTE_ATRIBUICAO',
    "observacao" TEXT,
    "importadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompraImportada_pkey" PRIMARY KEY ("id")
);

-- CreateTable CompraImportadaItem
CREATE TABLE "CompraImportadaItem" (
    "id" TEXT NOT NULL,
    "compraImportadaId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompraImportadaItem_pkey" PRIMARY KEY ("id")
);

-- AddColumn to PedidoCompra
ALTER TABLE "PedidoCompra" ADD COLUMN "compraImportadaId" TEXT;
ALTER TABLE "PedidoCompra" ADD COLUMN "statusAtribuicao" "StatusAtribuicao" NOT NULL DEFAULT 'PENDENTE_ATRIBUICAO';

-- AddColumn to AtribuicaoItem
ALTER TABLE "AtribuicaoItem" ADD COLUMN "compraImportadaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CompraImportada_fornecedorId_numeroPedido_key" ON "CompraImportada"("fornecedorId", "numeroPedido");
CREATE INDEX "CompraImportada_statusAtribuicao_idx" ON "CompraImportada"("statusAtribuicao");
CREATE INDEX "CompraImportada_importadaEm_idx" ON "CompraImportada"("importadaEm");
CREATE INDEX "CompraImportada_lojaId_idx" ON "CompraImportada"("lojaId");
CREATE INDEX "CompraImportadaItem_compraImportadaId_idx" ON "CompraImportadaItem"("compraImportadaId");
CREATE INDEX "PedidoCompra_compraImportadaId_idx" ON "PedidoCompra"("compraImportadaId");
CREATE INDEX "PedidoCompra_statusAtribuicao_idx" ON "PedidoCompra"("statusAtribuicao");
CREATE INDEX "AtribuicaoItem_compraImportadaId_idx" ON "AtribuicaoItem"("compraImportadaId");

-- AddForeignKey
ALTER TABLE "CompraImportada" ADD CONSTRAINT "CompraImportada_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompraImportadaItem" ADD CONSTRAINT "CompraImportadaItem_compraImportadaId_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PedidoCompra" ADD CONSTRAINT "PedidoCompra_compraImportadaId_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AtribuicaoItem" ADD CONSTRAINT "AtribuicaoItem_compraImportadaId_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
