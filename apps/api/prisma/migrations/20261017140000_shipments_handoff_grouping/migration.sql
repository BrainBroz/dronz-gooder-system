-- UX-5: modalidade do envio (mala de viajante ou caixa aérea), tipo do volume,
-- agrupamento físico entre lojas (D-11) e registro de handoff (D-13). Aditiva:
-- viagens e malas existentes continuam como MALA_VIAJANTE / MALA.

CREATE TYPE "ModalidadeEnvio" AS ENUM ('MALA_VIAJANTE', 'CAIXA_AEREA');
CREATE TYPE "TipoVolumeEnvio" AS ENUM ('MALA', 'CAIXA');

ALTER TABLE "Viagem" ADD COLUMN "modalidade" "ModalidadeEnvio" NOT NULL DEFAULT 'MALA_VIAJANTE',
ADD COLUMN "transportadora" TEXT,
ALTER COLUMN "viajanteId" DROP NOT NULL;
ALTER TABLE "Viagem" ADD CONSTRAINT "Viagem_modalidade_check" CHECK (
  ("modalidade" = 'MALA_VIAJANTE' AND "viajanteId" IS NOT NULL)
  OR ("modalidade" = 'CAIXA_AEREA' AND "transportadora" IS NOT NULL AND length(trim("transportadora")) > 0)
);

CREATE TABLE "GrupoFisico" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoVolumeEnvio" NOT NULL,
    "limitePesoKg" DECIMAL(8,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrupoFisico_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GrupoFisico_limite_check" CHECK ("tipo" <> 'MALA' OR ("limitePesoKg" IS NOT NULL AND "limitePesoKg" <= 23))
);
CREATE UNIQUE INDEX "GrupoFisico_codigo_key" ON "GrupoFisico"("codigo");

ALTER TABLE "Mala" ADD COLUMN "tipo" "TipoVolumeEnvio" NOT NULL DEFAULT 'MALA',
ADD COLUMN "grupoFisicoId" TEXT,
ALTER COLUMN "limitePesoKg" DROP NOT NULL;
-- Mala mantém o limite vigente de 23 kg; caixa aérea não herda esse limite.
ALTER TABLE "Mala" ADD CONSTRAINT "Mala_limite_check" CHECK ("tipo" <> 'MALA' OR ("limitePesoKg" IS NOT NULL AND "limitePesoKg" <= 23));
ALTER TABLE "Mala" ADD CONSTRAINT "Mala_grupoFisicoId_fkey" FOREIGN KEY ("grupoFisicoId") REFERENCES "GrupoFisico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Mala_grupoFisicoId_idx" ON "Mala"("grupoFisicoId");

CREATE TABLE "HandoffVolume" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "malaId" TEXT NOT NULL,
    "entreguePorId" TEXT NOT NULL,
    "recebidoPor" TEXT NOT NULL,
    "referencia" TEXT,
    "observacao" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HandoffVolume_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HandoffVolume_recebidoPor_check" CHECK (length(trim("recebidoPor")) > 0)
);
CREATE INDEX "HandoffVolume_lojaId_malaId_idx" ON "HandoffVolume"("lojaId", "malaId");
ALTER TABLE "HandoffVolume" ADD CONSTRAINT "HandoffVolume_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandoffVolume" ADD CONSTRAINT "HandoffVolume_malaId_lojaId_fkey" FOREIGN KEY ("malaId", "lojaId") REFERENCES "Mala"("id", "lojaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HandoffVolume" ADD CONSTRAINT "HandoffVolume_entreguePorId_fkey" FOREIGN KEY ("entreguePorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
