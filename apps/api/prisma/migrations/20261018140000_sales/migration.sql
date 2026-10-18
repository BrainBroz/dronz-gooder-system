-- CreateEnum
CREATE TYPE "CanalVenda" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'SITE_PROPRIO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('RASCUNHO', 'CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusRecebivelVenda" AS ENUM ('PENDENTE', 'PARCIAL', 'RECEBIDO');

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "pedidoCompraItemId" TEXT;

-- CreateTable
CREATE TABLE "Venda" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "canal" "CanalVenda" NOT NULL,
    "referenciaExterna" TEXT,
    "dataVenda" TIMESTAMP(3) NOT NULL,
    "moeda" TEXT NOT NULL,
    "estado" "StatusVenda" NOT NULL DEFAULT 'RASCUNHO',
    "observacao" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "confirmadoPorId" TEXT,
    "confirmadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaItem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DECIMAL(18,2) NOT NULL,
    "desconto" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxaMarketplace" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notaFiscal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "frete" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaixaVenda" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "vendaItemId" TEXT NOT NULL,
    "movimentoEntradaId" TEXT NOT NULL,
    "movimentoSaidaId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitario" DECIMAL(18,2),
    "moedaCusto" TEXT,
    "custoUnitarioConvertido" DECIMAL(18,2),
    "cotacaoCambioId" TEXT,
    "politica" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaixaVenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecebivelVenda" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "moeda" TEXT NOT NULL,
    "valorPrevisto" DECIMAL(18,2) NOT NULL,
    "valorRecebido" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dataPrevista" TIMESTAMP(3),
    "dataRecebida" TIMESTAMP(3),
    "status" "StatusRecebivelVenda" NOT NULL DEFAULT 'PENDENTE',
    "transacaoFonteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecebivelVenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venda_lojaId_dataVenda_idx" ON "Venda"("lojaId", "dataVenda");

-- CreateIndex
CREATE INDEX "Venda_lojaId_estado_idx" ON "Venda"("lojaId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Venda_id_lojaId_key" ON "Venda"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "Venda_lojaId_canal_referenciaExterna_key" ON "Venda"("lojaId", "canal", "referenciaExterna");

-- CreateIndex
CREATE INDEX "VendaItem_lojaId_produtoId_idx" ON "VendaItem"("lojaId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "VendaItem_id_lojaId_key" ON "VendaItem"("id", "lojaId");

-- CreateIndex
CREATE INDEX "BaixaVenda_lojaId_movimentoEntradaId_idx" ON "BaixaVenda"("lojaId", "movimentoEntradaId");

-- CreateIndex
CREATE INDEX "BaixaVenda_vendaItemId_idx" ON "BaixaVenda"("vendaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecebivelVenda_vendaId_key" ON "RecebivelVenda"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "RecebivelVenda_vendaId_lojaId_key" ON "RecebivelVenda"("vendaId", "lojaId");

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_vendaId_lojaId_fkey" FOREIGN KEY ("vendaId", "lojaId") REFERENCES "Venda"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaixaVenda" ADD CONSTRAINT "BaixaVenda_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaixaVenda" ADD CONSTRAINT "BaixaVenda_vendaItemId_lojaId_fkey" FOREIGN KEY ("vendaItemId", "lojaId") REFERENCES "VendaItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaixaVenda" ADD CONSTRAINT "BaixaVenda_movimentoEntradaId_lojaId_fkey" FOREIGN KEY ("movimentoEntradaId", "lojaId") REFERENCES "MovimentacaoEstoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaixaVenda" ADD CONSTRAINT "BaixaVenda_movimentoSaidaId_lojaId_fkey" FOREIGN KEY ("movimentoSaidaId", "lojaId") REFERENCES "MovimentacaoEstoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebivelVenda" ADD CONSTRAINT "RecebivelVenda_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebivelVenda" ADD CONSTRAINT "RecebivelVenda_vendaId_lojaId_fkey" FOREIGN KEY ("vendaId", "lojaId") REFERENCES "Venda"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lotes existentes: liga a ENTRY ao item de compra quando o recebimento tem um único item do produto.
UPDATE "MovimentacaoEstoque" m
SET "pedidoCompraItemId" = ri."pedidoCompraItemId"
FROM "RecebimentoItem" ri
WHERE m."tipo" = 'ENTRY'
  AND m."pedidoCompraItemId" IS NULL
  AND ri."recebimentoId" = m."recebimentoId"
  AND ri."produtoId" = m."produtoId"
  AND (SELECT count(*) FROM "RecebimentoItem" x WHERE x."recebimentoId" = m."recebimentoId" AND x."produtoId" = m."produtoId") = 1;

ALTER TABLE "VendaItem" ADD CONSTRAINT "VendaItem_valores_check" CHECK (
  "quantidade" > 0 AND "precoUnitario" >= 0 AND "desconto" >= 0 AND "taxaMarketplace" >= 0 AND "notaFiscal" >= 0 AND "frete" >= 0
);
ALTER TABLE "BaixaVenda" ADD CONSTRAINT "BaixaVenda_quantidade_check" CHECK ("quantidade" > 0);
ALTER TABLE "RecebivelVenda" ADD CONSTRAINT "RecebivelVenda_valores_check" CHECK (
  "valorPrevisto" >= 0 AND "valorRecebido" >= 0 AND "valorRecebido" <= "valorPrevisto"
);
