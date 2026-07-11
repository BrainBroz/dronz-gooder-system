-- CreateEnum
CREATE TYPE "PagamentoStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('CREDIT_CARD', 'PAYPAL', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- DropForeignKey
ALTER TABLE "AlocacaoMala" DROP CONSTRAINT "AlocacaoMala_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "AlocacaoMala" DROP CONSTRAINT "AlocacaoMala_malaId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "AlocacaoMala" DROP CONSTRAINT "AlocacaoMala_pedidoCompraItemId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "AlocacaoMala" DROP CONSTRAINT "AlocacaoMala_volumeLogisticoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Estoque" DROP CONSTRAINT "Estoque_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Estoque" DROP CONSTRAINT "Estoque_produtoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Mala" DROP CONSTRAINT "Mala_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Mala" DROP CONSTRAINT "Mala_viagemId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "MovimentacaoEstoque" DROP CONSTRAINT "MovimentacaoEstoque_estoqueId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "MovimentacaoEstoque" DROP CONSTRAINT "MovimentacaoEstoque_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "MovimentacaoEstoque" DROP CONSTRAINT "MovimentacaoEstoque_produtoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "MovimentacaoEstoque" DROP CONSTRAINT "MovimentacaoEstoque_recebimentoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "MovimentacaoEstoque" DROP CONSTRAINT "MovimentacaoEstoque_responsavelId_fkey";

-- DropForeignKey
ALTER TABLE "Recebimento" DROP CONSTRAINT "Recebimento_confirmadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "Recebimento" DROP CONSTRAINT "Recebimento_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Recebimento" DROP CONSTRAINT "Recebimento_malaId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Recebimento" DROP CONSTRAINT "Recebimento_viagemId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoItem" DROP CONSTRAINT "RecebimentoItem_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoItem" DROP CONSTRAINT "RecebimentoItem_pedidoCompraItemId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoItem" DROP CONSTRAINT "RecebimentoItem_produtoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoItem" DROP CONSTRAINT "RecebimentoItem_recebimentoId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoMiami" DROP CONSTRAINT "RecebimentoMiami_confirmadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoMiami" DROP CONSTRAINT "RecebimentoMiami_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "RecebimentoMiami" DROP CONSTRAINT "RecebimentoMiami_pedidoCompraItemId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Viagem" DROP CONSTRAINT "Viagem_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Viagem" DROP CONSTRAINT "Viagem_viajanteId_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "Viajante" DROP CONSTRAINT "Viajante_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "VolumeLogistico" DROP CONSTRAINT "VolumeLogistico_lojaId_fkey";

-- DropForeignKey
ALTER TABLE "VolumeLogistico" DROP CONSTRAINT "VolumeLogistico_malaId_lojaId_fkey";

-- CreateTable
CREATE TABLE "CotacaoCambio" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "moedaOrigem" TEXT NOT NULL,
    "moedaDestino" TEXT NOT NULL,
    "valor" DECIMAL(18,6) NOT NULL,
    "cotadoEm" TIMESTAMP(3) NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CotacaoCambio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "pedidoCompraId" TEXT NOT NULL,
    "formaPagamento" "FormaPagamento" NOT NULL,
    "moeda" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "PagamentoStatus" NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "referencia" TEXT,
    "observacoes" TEXT,
    "estornoDeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustoPedido" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "pedidoCompraId" TEXT NOT NULL,
    "cotacaoCambioId" TEXT,
    "iofPercentual" DECIMAL(8,6) NOT NULL DEFAULT 0,
    "iofValor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxas" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "custoAdicional" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalGlobal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustoPedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustoPedidoItem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "custoPedidoId" TEXT NOT NULL,
    "pedidoCompraItemId" TEXT NOT NULL,
    "custoRateado" DECIMAL(12,2) NOT NULL,
    "custoTotalUnitario" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustoPedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CotacaoCambio_lojaId_cotadoEm_idx" ON "CotacaoCambio"("lojaId", "cotadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "CotacaoCambio_id_lojaId_key" ON "CotacaoCambio"("id", "lojaId");

-- CreateIndex
CREATE INDEX "Pagamento_lojaId_pedidoCompraId_status_idx" ON "Pagamento"("lojaId", "pedidoCompraId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_id_lojaId_key" ON "Pagamento"("id", "lojaId");

-- CreateIndex
CREATE INDEX "CustoPedido_lojaId_pedidoCompraId_idx" ON "CustoPedido"("lojaId", "pedidoCompraId");

-- CreateIndex
CREATE UNIQUE INDEX "CustoPedido_pedidoCompraId_lojaId_key" ON "CustoPedido"("pedidoCompraId", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "CustoPedido_id_lojaId_key" ON "CustoPedido"("id", "lojaId");

-- CreateIndex
CREATE INDEX "CustoPedidoItem_lojaId_pedidoCompraItemId_idx" ON "CustoPedidoItem"("lojaId", "pedidoCompraItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CustoPedidoItem_custoPedidoId_pedidoCompraItemId_key" ON "CustoPedidoItem"("custoPedidoId", "pedidoCompraItemId");

-- AddForeignKey
ALTER TABLE "Viajante" ADD CONSTRAINT "Viajante_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viagem" ADD CONSTRAINT "Viagem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viagem" ADD CONSTRAINT "Viagem_viajanteId_lojaId_fkey" FOREIGN KEY ("viajanteId", "lojaId") REFERENCES "Viajante"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mala" ADD CONSTRAINT "Mala_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mala" ADD CONSTRAINT "Mala_viagemId_lojaId_fkey" FOREIGN KEY ("viagemId", "lojaId") REFERENCES "Viagem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeLogistico" ADD CONSTRAINT "VolumeLogistico_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeLogistico" ADD CONSTRAINT "VolumeLogistico_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlocacaoMala" ADD CONSTRAINT "AlocacaoMala_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlocacaoMala" ADD CONSTRAINT "AlocacaoMala_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlocacaoMala" ADD CONSTRAINT "AlocacaoMala_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlocacaoMala" ADD CONSTRAINT "AlocacaoMala_volumeLogisticoId_lojaId_fkey" FOREIGN KEY ("volumeLogisticoId", "lojaId") REFERENCES "VolumeLogistico"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_viagemId_lojaId_fkey" FOREIGN KEY ("viagemId", "lojaId") REFERENCES "Viagem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoItem" ADD CONSTRAINT "RecebimentoItem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoItem" ADD CONSTRAINT "RecebimentoItem_recebimentoId_lojaId_fkey" FOREIGN KEY ("recebimentoId", "lojaId") REFERENCES "Recebimento"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoItem" ADD CONSTRAINT "RecebimentoItem_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecebimentoItem" ADD CONSTRAINT "RecebimentoItem_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estoque" ADD CONSTRAINT "Estoque_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estoque" ADD CONSTRAINT "Estoque_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_produtoId_lojaId_fkey" FOREIGN KEY ("produtoId", "lojaId") REFERENCES "Produto"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_estoqueId_lojaId_fkey" FOREIGN KEY ("estoqueId", "lojaId") REFERENCES "Estoque"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_recebimentoId_lojaId_fkey" FOREIGN KEY ("recebimentoId", "lojaId") REFERENCES "Recebimento"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotacaoCambio" ADD CONSTRAINT "CotacaoCambio_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotacaoCambio" ADD CONSTRAINT "CotacaoCambio_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_pedidoCompraId_lojaId_fkey" FOREIGN KEY ("pedidoCompraId", "lojaId") REFERENCES "PedidoCompra"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPedido" ADD CONSTRAINT "CustoPedido_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPedido" ADD CONSTRAINT "CustoPedido_pedidoCompraId_lojaId_fkey" FOREIGN KEY ("pedidoCompraId", "lojaId") REFERENCES "PedidoCompra"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPedido" ADD CONSTRAINT "CustoPedido_cotacaoCambioId_lojaId_fkey" FOREIGN KEY ("cotacaoCambioId", "lojaId") REFERENCES "CotacaoCambio"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPedidoItem" ADD CONSTRAINT "CustoPedidoItem_custoPedidoId_lojaId_fkey" FOREIGN KEY ("custoPedidoId", "lojaId") REFERENCES "CustoPedido"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustoPedidoItem" ADD CONSTRAINT "CustoPedidoItem_pedidoCompraItemId_lojaId_fkey" FOREIGN KEY ("pedidoCompraItemId", "lojaId") REFERENCES "PedidoCompraItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
