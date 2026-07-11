-- CreateEnum
CREATE TYPE "TipoDivergenciaParaguai" AS ENUM ('CORRETO', 'MALA_AUSENTE', 'VOLUME_AUSENTE', 'ITEM_NAO_LOCALIZADO', 'QUANTIDADE_DIVERGENTE', 'AVARIA', 'ITEM_EXTRA', 'CHECKPOINT_PARCIAL');

-- CreateTable
CREATE TABLE "CheckpointParaguai" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "viagemId" TEXT NOT NULL,
    "malaId" TEXT NOT NULL,
    "confirmadoPorId" TEXT NOT NULL,
    "confirmadoEm" TIMESTAMP(3) NOT NULL,
    "observacao" TEXT,
    "tipoDivergencia" "TipoDivergenciaParaguai" NOT NULL DEFAULT 'CORRETO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckpointParaguai_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckpointParaguai_lojaId_viagemId_idx" ON "CheckpointParaguai"("lojaId", "viagemId");

-- CreateIndex
CREATE INDEX "CheckpointParaguai_lojaId_malaId_idx" ON "CheckpointParaguai"("lojaId", "malaId");

-- CreateIndex
CREATE INDEX "CheckpointParaguai_lojaId_tipoDivergencia_idx" ON "CheckpointParaguai"("lojaId", "tipoDivergencia");

-- AddForeignKey
ALTER TABLE "CheckpointParaguai" ADD CONSTRAINT "CheckpointParaguai_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointParaguai" ADD CONSTRAINT "CheckpointParaguai_viagemId_lojaId_fkey" FOREIGN KEY ("viagemId", "lojaId") REFERENCES "Viagem"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointParaguai" ADD CONSTRAINT "CheckpointParaguai_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckpointParaguai" ADD CONSTRAINT "CheckpointParaguai_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
