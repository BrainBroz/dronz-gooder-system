-- Add quantidadeViajantes field to SimulacaoViagem
ALTER TABLE "SimulacaoViagem" ADD COLUMN "quantidadeViajantes" INTEGER NOT NULL DEFAULT 1;
