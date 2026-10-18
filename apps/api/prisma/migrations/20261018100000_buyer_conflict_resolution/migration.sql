-- X-01: resolução humana e motivada das divergências de evidência buyer.
-- CreateEnum
CREATE TYPE "ResolucaoConflitoEvidencia" AS ENUM ('ACEITAR_EVIDENCIA', 'MANTER_REFERENCIA', 'CIENTE');

-- AlterTable
ALTER TABLE "BuyerReconciliationConflict" ADD COLUMN     "motivoResolucao" TEXT,
ADD COLUMN     "resolucao" "ResolucaoConflitoEvidencia",
ADD COLUMN     "resolvidoEm" TIMESTAMP(3),
ADD COLUMN     "resolvidoPorId" TEXT;

-- AddForeignKey
ALTER TABLE "BuyerReconciliationConflict" ADD CONSTRAINT "BuyerReconciliationConflict_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
