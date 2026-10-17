-- The parent simulation ID is globally unique; the composite key preserves
-- the existing one-to-one rule while matching the tenant-scoped Prisma relation.
CREATE UNIQUE INDEX "SimulacaoViagemCusto_simulacaoViagemId_lojaId_key"
  ON "SimulacaoViagemCusto"("simulacaoViagemId", "lojaId");
CREATE UNIQUE INDEX "SimulacaoViagemParametro_simulacaoViagemId_lojaId_key"
  ON "SimulacaoViagemParametro"("simulacaoViagemId", "lojaId");
DROP INDEX "SimulacaoViagemCusto_simulacaoViagemId_key";
DROP INDEX "SimulacaoViagemParametro_simulacaoViagemId_key";
