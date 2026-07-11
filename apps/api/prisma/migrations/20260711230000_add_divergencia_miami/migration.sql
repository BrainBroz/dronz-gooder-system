-- CreateEnum
CREATE TYPE "TipoDivergenciaMiami" AS ENUM ('CORRETO', 'FALTANTE', 'QUANTIDADE_DIVERGENTE', 'DANIFICADO', 'DESCONHECIDO', 'TRACKING_NAO_LOCALIZADO');

-- AlterTable
ALTER TABLE "RecebimentoMiami" ADD COLUMN "tipoDivergencia" "TipoDivergenciaMiami" NOT NULL DEFAULT 'CORRETO';

-- CreateIndex
CREATE INDEX "RecebimentoMiami_lojaId_tipoDivergencia_idx" ON "RecebimentoMiami"("lojaId", "tipoDivergencia");
