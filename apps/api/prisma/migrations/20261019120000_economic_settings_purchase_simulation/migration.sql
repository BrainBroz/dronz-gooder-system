-- CreateEnum
CREATE TYPE "NotaFiscalBase" AS ENUM ('VENDA_BRUTA', 'BASE_INFORMADA');

-- CreateEnum
CREATE TYPE "ModalidadeTaxaMarketplace" AS ENUM ('A_VISTA', 'PARCELADO');

-- CreateTable
CREATE TABLE "ParametroEconomico" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "acrescimoCambialBrl" DECIMAL(18,6) NOT NULL,
    "freteValorPorKg" DECIMAL(18,6),
    "freteMoeda" TEXT,
    "markupAlertaPercentual" DECIMAL(8,4) NOT NULL,
    "notaFiscalPercentual" DECIMAL(8,4),
    "notaFiscalBase" "NotaFiscalBase",
    "iofPercentual" DECIMAL(8,4),
    "observacoes" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParametroEconomico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxaMarketplaceParametro" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "parametroEconomicoId" TEXT NOT NULL,
    "canal" "CanalVenda" NOT NULL,
    "modalidade" "ModalidadeTaxaMarketplace" NOT NULL,
    "parcelas" INTEGER,
    "percentual" DECIMAL(8,4) NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "TaxaMarketplaceParametro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulacaoCompra" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "produtoId" TEXT,
    "produtoNome" TEXT NOT NULL,
    "produtoCodigo" INTEGER,
    "parametroEconomicoId" TEXT,
    "cotacaoCambioId" TEXT,
    "entrada" JSONB NOT NULL,
    "resultado" JSONB NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulacaoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParametroEconomico_lojaId_versao_key" ON "ParametroEconomico"("lojaId", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "ParametroEconomico_id_lojaId_key" ON "ParametroEconomico"("id", "lojaId");

-- CreateIndex
CREATE INDEX "TaxaMarketplaceParametro_lojaId_parametroEconomicoId_idx" ON "TaxaMarketplaceParametro"("lojaId", "parametroEconomicoId");

-- CreateIndex
CREATE INDEX "SimulacaoCompra_lojaId_createdAt_idx" ON "SimulacaoCompra"("lojaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacaoCompra_id_lojaId_key" ON "SimulacaoCompra"("id", "lojaId");

-- AddForeignKey
ALTER TABLE "ParametroEconomico" ADD CONSTRAINT "ParametroEconomico_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParametroEconomico" ADD CONSTRAINT "ParametroEconomico_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxaMarketplaceParametro" ADD CONSTRAINT "TaxaMarketplaceParametro_parametroEconomicoId_lojaId_fkey" FOREIGN KEY ("parametroEconomicoId", "lojaId") REFERENCES "ParametroEconomico"("id", "lojaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoCompra" ADD CONSTRAINT "SimulacaoCompra_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoCompra" ADD CONSTRAINT "SimulacaoCompra_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoCompra" ADD CONSTRAINT "SimulacaoCompra_parametroEconomicoId_lojaId_fkey" FOREIGN KEY ("parametroEconomicoId", "lojaId") REFERENCES "ParametroEconomico"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacaoCompra" ADD CONSTRAINT "SimulacaoCompra_cotacaoCambioId_lojaId_fkey" FOREIGN KEY ("cotacaoCambioId", "lojaId") REFERENCES "CotacaoCambio"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integridade dos parâmetros (validada também na API).
ALTER TABLE "ParametroEconomico"
  ADD CONSTRAINT "ParametroEconomico_acrescimo_check" CHECK ("acrescimoCambialBrl" >= 0),
  ADD CONSTRAINT "ParametroEconomico_frete_check" CHECK (
    ("freteValorPorKg" IS NULL AND "freteMoeda" IS NULL)
    OR ("freteValorPorKg" >= 0 AND "freteMoeda" IN ('USD', 'BRL'))
  ),
  ADD CONSTRAINT "ParametroEconomico_percentuais_check" CHECK (
    "markupAlertaPercentual" >= 0
    AND ("notaFiscalPercentual" IS NULL OR ("notaFiscalPercentual" >= 0 AND "notaFiscalPercentual" < 100))
    AND ("iofPercentual" IS NULL OR ("iofPercentual" >= 0 AND "iofPercentual" < 100))
  ),
  ADD CONSTRAINT "ParametroEconomico_versao_check" CHECK ("versao" >= 1);

ALTER TABLE "TaxaMarketplaceParametro"
  ADD CONSTRAINT "TaxaMarketplaceParametro_parcelas_check" CHECK (
    ("modalidade" = 'A_VISTA' AND "parcelas" IS NULL)
    OR ("modalidade" = 'PARCELADO' AND "parcelas" BETWEEN 1 AND 24)
  ),
  ADD CONSTRAINT "TaxaMarketplaceParametro_percentual_check" CHECK ("percentual" >= 0 AND "percentual" < 100);
