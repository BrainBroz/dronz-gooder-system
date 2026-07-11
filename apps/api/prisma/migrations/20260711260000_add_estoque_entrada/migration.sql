-- CreateEnum
CREATE TYPE "EstoqueEntradaStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "EstoqueEntrada" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "malaId" TEXT NOT NULL,
    "confirmadoPorId" TEXT NOT NULL,
    "confirmadoEm" TIMESTAMP(3) NOT NULL,
    "status" "EstoqueEntradaStatus" NOT NULL DEFAULT 'PENDING',
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueEntrada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EstoqueEntrada_lojaId_viagemId_idx" ON "EstoqueEntrada"("lojaId", "viagemId");

-- CreateIndex
CREATE INDEX "EstoqueEntrada_lojaId_malaId_idx" ON "EstoqueEntrada"("lojaId", "malaId");

-- CreateIndex
CREATE INDEX "EstoqueEntrada_lojaId_status_idx" ON "EstoqueEntrada"("lojaId", "status");

-- AddForeignKey
ALTER TABLE "EstoqueEntrada" ADD CONSTRAINT "EstoqueEntrada_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueEntrada" ADD CONSTRAINT "EstoqueEntrada_viagemId_lojaId_fkey" FOREIGN KEY ("viagemId", "lojaId") REFERENCES "Viagem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueEntrada" ADD CONSTRAINT "EstoqueEntrada_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueEntrada" ADD CONSTRAINT "EstoqueEntrada_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
