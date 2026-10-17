ALTER TABLE "CotacaoCambio"
  ADD COLUMN "valorMercado" DECIMAL(18,6),
  ADD COLUMN "margem" DECIMAL(18,6) NOT NULL DEFAULT 0.20;

-- A cotação legada já guardava o valor efetivo em "valor". Preserva-o sem
-- aplicar retroativamente a margem das novas cotações.
UPDATE "CotacaoCambio"
SET "valorMercado" = "valor", "margem" = 0.00;

ALTER TABLE "CotacaoCambio"
  ALTER COLUMN "valorMercado" SET NOT NULL;
