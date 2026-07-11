-- Remove the incorrect pedidoCompraId column if it exists
ALTER TABLE "AtribuicaoItem" DROP COLUMN IF EXISTS "pedidoCompraId";
