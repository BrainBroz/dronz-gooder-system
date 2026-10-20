-- CreateTable
CREATE TABLE "ProdutoBase" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoria" TEXT,
    "pesoKg" DECIMAL(10,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoBase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoBase_slug_key" ON "ProdutoBase"("slug");

-- CreateIndex
CREATE INDEX "ProdutoBase_categoria_idx" ON "ProdutoBase"("categoria");
