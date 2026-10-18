-- F-5: a cotação manual registra a fonte informada. X-08: a margem é informada
-- por cotação; nenhum acréscimo histórico é aplicado por default.
ALTER TABLE "CotacaoCambio" ADD COLUMN "fonte" TEXT;
ALTER TABLE "CotacaoCambio" ALTER COLUMN "margem" DROP DEFAULT;
