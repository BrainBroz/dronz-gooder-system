-- CreateEnum
CREATE TYPE "TipoDivergenciaBrasil" AS ENUM ('CORRETO', 'MALA_AUSENTE', 'ITEM_NAO_LOCALIZADO', 'QUANTIDADE_DIVERGENTE', 'AVARIA', 'ITEM_EXTRA', 'REGISTRO_ADUANEIRO_DIVERGENTE', 'LACRE_ROMPIDO');

-- CreateTable
CREATE TABLE "CheckpointBrasil" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "malaId" TEXT NOT NULL,
    "confirmadoPorId" TEXT NOT NULL,
    "confirmadoEm" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,
    "tipoDivergencia" "TipoDivergenciaBrasil" NOT NULL DEFAULT 'CORRETO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckpointBrasil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckpointBrasil_lojaId_viagemId_idx" ON "CheckpointBrasil"("lojaId", "viagemId");

-- CreateIndex
CREATE INDEX "CheckpointBrasil_lojaId_malaId_idx" ON "CheckpointBrasil"("lojaId", "malaId");

-- CreateIndex
CREATE INDEX "CheckpointBrasil_lojaId_tipoDivergencia_idx" ON "CheckpointBrasil"("lojaId", "tipoDivergencia");

-- AddForeignKey
ALTER TABLE "CheckpointBrasil" ADD CONSTRAINT "CheckpointBrasil_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointBrasil" ADD CONSTRAINT "CheckpointBrasil_viagemId_lojaId_fkey" FOREIGN KEY ("viagemId", "lojaId") REFERENCES "Viagem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointBrasil" ADD CONSTRAINT "CheckpointBrasil_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointBrasil" ADD CONSTRAINT "CheckpointBrasil_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
