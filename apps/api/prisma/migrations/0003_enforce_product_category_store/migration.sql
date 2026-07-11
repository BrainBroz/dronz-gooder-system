DROP INDEX IF EXISTS "Categoria_id_lojaId_key";
CREATE UNIQUE INDEX "Categoria_id_lojaId_key" ON "Categoria"("id", "lojaId");

ALTER TABLE "Produto" DROP CONSTRAINT "Produto_categoriaId_fkey";
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_categoriaId_lojaId_fkey"
  FOREIGN KEY ("categoriaId", "lojaId")
  REFERENCES "Categoria"("id", "lojaId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
