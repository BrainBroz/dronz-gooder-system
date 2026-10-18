-- CreateEnum
CREATE TYPE "StatusDevolucaoVenda" AS ENUM ('PENDENTE', 'CONFERIDA', 'REJEITADA');

-- AlterEnum
ALTER TYPE "StatusRecebivelVenda" ADD VALUE 'ESTORNADO';

-- AlterEnum
ALTER TYPE "StatusVenda" ADD VALUE 'ESTORNADA';

-- AlterTable
ALTER TABLE "BaixaVenda" ADD COLUMN     "revertidaEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Venda" ADD COLUMN     "estornadaEm" TIMESTAMP(3),
ADD COLUMN     "estornadaPorId" TEXT,
ADD COLUMN     "motivoEstorno" TEXT;

-- CreateTable
CREATE TABLE "DevolucaoVenda" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "vendaItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "estado" "StatusDevolucaoVenda" NOT NULL DEFAULT 'PENDENTE',
    "motivo" TEXT NOT NULL,
    "registradoPorId" TEXT NOT NULL,
    "conferidoPorId" TEXT,
    "conferidoEm" TIMESTAMP(3),
    "condicaoComercial" "CondicaoComercial",
    "funcionamento" "Funcionamento",
    "observacaoConferencia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevolucaoVenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevolucaoVenda_lojaId_estado_idx" ON "DevolucaoVenda"("lojaId", "estado");

-- CreateIndex
CREATE INDEX "DevolucaoVenda_vendaItemId_idx" ON "DevolucaoVenda"("vendaItemId");

-- AddForeignKey
ALTER TABLE "DevolucaoVenda" ADD CONSTRAINT "DevolucaoVenda_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevolucaoVenda" ADD CONSTRAINT "DevolucaoVenda_vendaId_lojaId_fkey" FOREIGN KEY ("vendaId", "lojaId") REFERENCES "Venda"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevolucaoVenda" ADD CONSTRAINT "DevolucaoVenda_vendaItemId_lojaId_fkey" FOREIGN KEY ("vendaItemId", "lojaId") REFERENCES "VendaItem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DevolucaoVenda" ADD CONSTRAINT "DevolucaoVenda_quantidade_check" CHECK ("quantidade" > 0);
