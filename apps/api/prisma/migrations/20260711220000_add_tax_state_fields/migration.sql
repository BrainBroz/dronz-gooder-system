-- Add tax state fields to SimulacaoViagem
ALTER TABLE "SimulacaoViagem" ADD COLUMN "riscoEfetivado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SimulacaoViagem" ADD COLUMN "tributacaoEfetivadaBrl" DECIMAL(12,2) NOT NULL DEFAULT 0;
