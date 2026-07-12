-- AddColumn quantidadeJaIncorporada to RecebimentoItem
ALTER TABLE "RecebimentoItem" ADD COLUMN "quantidadeJaIncorporada" INTEGER NOT NULL DEFAULT 0;
