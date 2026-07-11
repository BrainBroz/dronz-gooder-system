-- Drop the incorrect FK if it exists
ALTER TABLE "AtribuicaoItem" DROP CONSTRAINT IF EXISTS "AtribuicaoItem_pedidoCompraId_fkey";
