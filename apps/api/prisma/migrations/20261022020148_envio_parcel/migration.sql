-- CreateTable
CREATE TABLE "EnvioParcel" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "erro" TEXT,
    "tentadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvioParcel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvioParcel_codigo_key" ON "EnvioParcel"("codigo");

-- CreateIndex
CREATE INDEX "EnvioParcel_tentadoEm_idx" ON "EnvioParcel"("tentadoEm");
