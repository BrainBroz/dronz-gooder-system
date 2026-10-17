CREATE TYPE "DespesaCategoria" AS ENUM ('PROLABORE', 'OPERACIONAL', 'REINVESTIMENTO');

CREATE TABLE "Despesa" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "categoria" "DespesaCategoria" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "dataDespesa" TIMESTAMP(3) NOT NULL,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Despesa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Despesa_id_lojaId_key" ON "Despesa"("id", "lojaId");
CREATE INDEX "Despesa_lojaId_categoria_idx" ON "Despesa"("lojaId", "categoria");
CREATE INDEX "Despesa_lojaId_dataDespesa_idx" ON "Despesa"("lojaId", "dataDespesa");

ALTER TABLE "Despesa" ADD CONSTRAINT "Despesa_lojaId_fkey"
    FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
