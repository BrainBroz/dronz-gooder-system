-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descricao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "codigo" INTEGER NOT NULL,
    "lojaId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descricao" TEXT,
    "precoVenda" DECIMAL(10,2) NOT NULL,
    "markup" DECIMAL(5,2) NOT NULL,
    "peso" DECIMAL(10,3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Categoria_lojaId_slug_key" ON "Categoria"("lojaId", "slug");
CREATE INDEX "Categoria_lojaId_idx" ON "Categoria"("lojaId");
CREATE INDEX "Categoria_lojaId_ativo_idx" ON "Categoria"("lojaId", "ativo");

CREATE UNIQUE INDEX "Produto_codigo_key" ON "Produto"("codigo");
CREATE UNIQUE INDEX "Produto_lojaId_slug_key" ON "Produto"("lojaId", "slug");
CREATE INDEX "Produto_lojaId_idx" ON "Produto"("lojaId");
CREATE INDEX "Produto_lojaId_categoriaId_idx" ON "Produto"("lojaId", "categoriaId");
CREATE INDEX "Produto_lojaId_ativo_idx" ON "Produto"("lojaId", "ativo");

ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
