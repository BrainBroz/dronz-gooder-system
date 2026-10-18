-- CreateEnum
CREATE TYPE "ImpactoDespesa" AS ENUM ('DESPESA_RESULTADO', 'TRANSFERENCIA', 'CUSTO_AQUISICAO', 'APLICACAO_CAPITAL');

-- CreateEnum
CREATE TYPE "TipoContaFinanceira" AS ENUM ('PAYPAL', 'CARTAO', 'BANCO', 'CAIXA');

-- CreateEnum
CREATE TYPE "StatusContaFinanceira" AS ENUM ('ATIVA', 'INATIVA');

-- CreateEnum
CREATE TYPE "StatusFaturaCartao" AS ENUM ('ABERTA', 'FECHADA', 'QUITADA');

-- CreateEnum
CREATE TYPE "TipoLancamentoCartao" AS ENUM ('DEBITO', 'CREDITO', 'TAXA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "TipoTransacaoFonte" AS ENUM ('COMPRA', 'TAXA', 'CONVERSAO', 'REEMBOLSO', 'PAGAMENTO_FATURA');

-- CreateEnum
CREATE TYPE "StatusConciliacaoFinanceira" AS ENUM ('PENDENTE_REVISAO', 'CONCILIADO', 'POSSIVEL_DUPLICIDADE', 'SEM_PAGAMENTO_ASSOCIADO', 'IGNORADO');

-- AlterTable
ALTER TABLE "Despesa" ADD COLUMN     "impacto" "ImpactoDespesa" NOT NULL DEFAULT 'DESPESA_RESULTADO',
ADD COLUMN     "moeda" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN     "origemId" TEXT,
ADD COLUMN     "origemTipo" TEXT;

-- CreateTable
CREATE TABLE "ContaFinanceira" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "tipo" "TipoContaFinanceira" NOT NULL,
    "apelido" TEXT NOT NULL,
    "moedaPrincipal" TEXT NOT NULL,
    "estado" "StatusContaFinanceira" NOT NULL DEFAULT 'ATIVA',
    "referenciaExterna" TEXT,
    "emissor" TEXT,
    "ultimosQuatro" VARCHAR(4),
    "diaFechamento" INTEGER,
    "diaVencimento" INTEGER,
    "limite" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaturaCartao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "moeda" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "vencimento" DATE NOT NULL,
    "estado" "StatusFaturaCartao" NOT NULL DEFAULT 'ABERTA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaturaCartao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoCartao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "tipo" "TipoLancamentoCartao" NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT,
    "pagamentoId" TEXT,
    "parcelaNumero" INTEGER,
    "parcelaTotal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LancamentoCartao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoFatura" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "contaOrigemId" TEXT,
    "valor" DECIMAL(18,2) NOT NULL,
    "pagoEm" TIMESTAMP(3) NOT NULL,
    "referencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagamentoFatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransacaoFinanceiraFonte" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "tipo" "TipoTransacaoFonte" NOT NULL,
    "moeda" TEXT NOT NULL,
    "bruto" DECIMAL(18,2) NOT NULL,
    "taxa" DECIMAL(18,2),
    "liquido" DECIMAL(18,2),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "statusFonte" TEXT,
    "contraparte" TEXT,
    "payloadHash" TEXT NOT NULL,
    "substituidaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransacaoFinanceiraFonte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciliacaoFinanceira" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "transacaoFonteId" TEXT NOT NULL,
    "pagamentoId" TEXT,
    "sugeridoPagamentoId" TEXT,
    "estado" "StatusConciliacaoFinanceira" NOT NULL,
    "motivo" TEXT,
    "revisadoPorId" TEXT,
    "revisadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConciliacaoFinanceira_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContaFinanceira_id_lojaId_key" ON "ContaFinanceira"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "ContaFinanceira_lojaId_apelido_key" ON "ContaFinanceira"("lojaId", "apelido");

-- CreateIndex
CREATE UNIQUE INDEX "FaturaCartao_id_lojaId_key" ON "FaturaCartao"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "FaturaCartao_contaId_inicio_key" ON "FaturaCartao"("contaId", "inicio");

-- CreateIndex
CREATE INDEX "LancamentoCartao_lojaId_faturaId_idx" ON "LancamentoCartao"("lojaId", "faturaId");

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoCartao_pagamentoId_parcelaNumero_key" ON "LancamentoCartao"("pagamentoId", "parcelaNumero");

-- CreateIndex
CREATE INDEX "PagamentoFatura_lojaId_faturaId_idx" ON "PagamentoFatura"("lojaId", "faturaId");

-- CreateIndex
CREATE INDEX "TransacaoFinanceiraFonte_lojaId_occurredAt_idx" ON "TransacaoFinanceiraFonte"("lojaId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransacaoFinanceiraFonte_id_lojaId_key" ON "TransacaoFinanceiraFonte"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "TransacaoFinanceiraFonte_contaId_provider_transactionId_ver_key" ON "TransacaoFinanceiraFonte"("contaId", "provider", "transactionId", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "ConciliacaoFinanceira_transacaoFonteId_key" ON "ConciliacaoFinanceira"("transacaoFonteId");

-- CreateIndex
CREATE INDEX "ConciliacaoFinanceira_lojaId_estado_idx" ON "ConciliacaoFinanceira"("lojaId", "estado");

-- CreateIndex
CREATE INDEX "ConciliacaoFinanceira_pagamentoId_idx" ON "ConciliacaoFinanceira"("pagamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "ConciliacaoFinanceira_transacaoFonteId_lojaId_key" ON "ConciliacaoFinanceira"("transacaoFonteId", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "Despesa_lojaId_origemTipo_origemId_key" ON "Despesa"("lojaId", "origemTipo", "origemId");

-- AddForeignKey
ALTER TABLE "ContaFinanceira" ADD CONSTRAINT "ContaFinanceira_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaturaCartao" ADD CONSTRAINT "FaturaCartao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaturaCartao" ADD CONSTRAINT "FaturaCartao_contaId_lojaId_fkey" FOREIGN KEY ("contaId", "lojaId") REFERENCES "ContaFinanceira"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoCartao" ADD CONSTRAINT "LancamentoCartao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoCartao" ADD CONSTRAINT "LancamentoCartao_faturaId_lojaId_fkey" FOREIGN KEY ("faturaId", "lojaId") REFERENCES "FaturaCartao"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoCartao" ADD CONSTRAINT "LancamentoCartao_pagamentoId_lojaId_fkey" FOREIGN KEY ("pagamentoId", "lojaId") REFERENCES "Pagamento"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoFatura" ADD CONSTRAINT "PagamentoFatura_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoFatura" ADD CONSTRAINT "PagamentoFatura_faturaId_lojaId_fkey" FOREIGN KEY ("faturaId", "lojaId") REFERENCES "FaturaCartao"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoFatura" ADD CONSTRAINT "PagamentoFatura_contaOrigemId_lojaId_fkey" FOREIGN KEY ("contaOrigemId", "lojaId") REFERENCES "ContaFinanceira"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransacaoFinanceiraFonte" ADD CONSTRAINT "TransacaoFinanceiraFonte_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransacaoFinanceiraFonte" ADD CONSTRAINT "TransacaoFinanceiraFonte_contaId_lojaId_fkey" FOREIGN KEY ("contaId", "lojaId") REFERENCES "ContaFinanceira"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciliacaoFinanceira" ADD CONSTRAINT "ConciliacaoFinanceira_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciliacaoFinanceira" ADD CONSTRAINT "ConciliacaoFinanceira_transacaoFonteId_lojaId_fkey" FOREIGN KEY ("transacaoFonteId", "lojaId") REFERENCES "TransacaoFinanceiraFonte"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciliacaoFinanceira" ADD CONSTRAINT "ConciliacaoFinanceira_pagamentoId_lojaId_fkey" FOREIGN KEY ("pagamentoId", "lojaId") REFERENCES "Pagamento"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciliacaoFinanceira" ADD CONSTRAINT "ConciliacaoFinanceira_revisadoPorId_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras de domínio no banco: dados de cartão mínimos e valores positivos.
ALTER TABLE "ContaFinanceira" ADD CONSTRAINT "ContaFinanceira_cartao_check" CHECK (
  "tipo" <> 'CARTAO' OR ("ultimosQuatro" ~ '^[0-9]{4}$' AND "diaFechamento" BETWEEN 1 AND 31 AND "diaVencimento" BETWEEN 1 AND 31)
);
ALTER TABLE "ContaFinanceira" ADD CONSTRAINT "ContaFinanceira_limite_check" CHECK ("limite" IS NULL OR "limite" > 0);
ALTER TABLE "FaturaCartao" ADD CONSTRAINT "FaturaCartao_periodo_check" CHECK ("inicio" <= "fim" AND "fim" <= "vencimento");
ALTER TABLE "LancamentoCartao" ADD CONSTRAINT "LancamentoCartao_valor_check" CHECK ("valor" > 0);
ALTER TABLE "LancamentoCartao" ADD CONSTRAINT "LancamentoCartao_parcela_check" CHECK (
  ("parcelaNumero" IS NULL AND "parcelaTotal" IS NULL) OR ("parcelaNumero" BETWEEN 1 AND "parcelaTotal")
);
ALTER TABLE "PagamentoFatura" ADD CONSTRAINT "PagamentoFatura_valor_check" CHECK ("valor" > 0);
ALTER TABLE "Despesa" ADD CONSTRAINT "Despesa_valor_check" CHECK ("valor" > 0);
