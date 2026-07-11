-- CreateEnum
CREATE TYPE "SimulacaoRisco" AS ENUM ('SEM_RISCO', 'SIMULACAO', 'EFETIVADA');

-- CreateTable
CREATE TABLE "SimulacaoViagem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacaoViagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacaoViagemItem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "simulacaoViagemId" TEXT NOT NULL,
    "nomeItem" TEXT NOT NULL,
    "categoriaId" TEXT,
    "custoUnitario" DECIMAL(12,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoVendaUnitario" DECIMAL(12,2) NOT NULL,
    "pesoUnitarioKg" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacaoViagemItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacaoViagemCusto" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "simulacaoViagemId" TEXT NOT NULL,
    "comissao" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "passagens" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hotel" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "carro" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "alimentacao" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gasolina" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "diversos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacaoViagemCusto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacaoViagemParametro" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "simulacaoViagemId" TEXT NOT NULL,
    "custoEnvioPorKgUsd" DECIMAL(12,4) NOT NULL,
    "cotacaoDolar" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacaoViagemParametro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulacaoViagem_lojaId_idx" ON "SimulacaoViagem"("lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoViagem_id_lojaId_key" ON "SimulacaoViagem"("id", "lojaId");

-- CreateIndex
CREATE INDEX "SimulacaoViagemItem_lojaId_simulacaoViagemId_idx" ON "SimulacaoViagemItem"("lojaId", "simulacaoViagemId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoViagemCusto_simulacaoViagemId_key" ON "SimulacaoViagemCusto"("simulacaoViagemId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoViagemCusto_id_lojaId_key" ON "SimulacaoViagemCusto"("id", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoViagemParametro_simulacaoViagemId_key" ON "SimulacaoViagemParametro"("simulacaoViagemId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoViagemParametro_id_lojaId_key" ON "SimulacaoViagemParametro"("id", "lojaId");

-- AddForeignKey
ALTER TABLE "SimulacaoViagem" ADD CONSTRAINT "SimulacaoViagem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoViagem" ADD CONSTRAINT "SimulacaoViagem_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoViagemItem" ADD CONSTRAINT "SimulacaoViagemItem_simulacaoViagemId_lojaId_fkey" FOREIGN KEY ("simulacaoViagemId", "lojaId") REFERENCES "SimulacaoViagem"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoViagemCusto" ADD CONSTRAINT "SimulacaoViagemCusto_simulacaoViagemId_lojaId_fkey" FOREIGN KEY ("simulacaoViagemId", "lojaId") REFERENCES "SimulacaoViagem"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoViagemParametro" ADD CONSTRAINT "SimulacaoViagemParametro_simulacaoViagemId_lojaId_fkey" FOREIGN KEY ("simulacaoViagemId", "lojaId") REFERENCES "SimulacaoViagem"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;
