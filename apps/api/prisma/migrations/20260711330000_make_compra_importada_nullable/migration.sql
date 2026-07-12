-- Make compraImportadaId nullable in AtribuicaoItem
ALTER TABLE "AtribuicaoItem" ALTER COLUMN "compraImportadaId" DROP NOT NULL;
