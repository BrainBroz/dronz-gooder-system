-- CreateTable
CREATE TABLE "StatusRastreio" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "transportadora" TEXT,
    "statusCodigo" INTEGER NOT NULL,
    "ultimoEvento" TEXT,
    "ultimoEventoLocal" TEXT,
    "ultimoEventoData" TEXT,
    "previstaEm" TEXT,
    "consultadoEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusRastreio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatusRastreio_codigo_key" ON "StatusRastreio"("codigo");
