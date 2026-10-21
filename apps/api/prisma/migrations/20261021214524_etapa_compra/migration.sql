-- CreateEnum
CREATE TYPE "EtapaLogistica" AS ENUM ('EM_MIAMI', 'EM_REMESSA', 'NO_BRASIL');

-- CreateTable
CREATE TABLE "EtapaCompra" (
    "id" TEXT NOT NULL,
    "compraImportadaId" TEXT NOT NULL,
    "etapa" "EtapaLogistica" NOT NULL,
    "chegouMiamiEm" TIMESTAMP(3),
    "remessa" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "chegouBrasilEm" TIMESTAMP(3),
    "atualizadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtapaCompra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EtapaCompra_compraImportadaId_key" ON "EtapaCompra"("compraImportadaId");

-- CreateIndex
CREATE INDEX "EtapaCompra_etapa_idx" ON "EtapaCompra"("etapa");

-- AddForeignKey
ALTER TABLE "EtapaCompra" ADD CONSTRAINT "EtapaCompra_compraImportadaId_fkey" FOREIGN KEY ("compraImportadaId") REFERENCES "CompraImportada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
