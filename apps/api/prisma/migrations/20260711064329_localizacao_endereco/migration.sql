-- CreateTable
CREATE TABLE "Endereco" (
    "id" TEXT NOT NULL,
    "localizacaoId" TEXT NOT NULL,
    "rua" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "pais" TEXT,
    "validoDe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validoAte" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endereco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalizacaoLoja" (
    "id" TEXT NOT NULL,
    "localizacaoId" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalizacaoLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioLocalizacao" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "localizacaoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuarioLocalizacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Endereco_localizacaoId_validoAte_idx" ON "Endereco"("localizacaoId", "validoAte");

-- CreateIndex
CREATE UNIQUE INDEX "LocalizacaoLoja_localizacaoId_lojaId_key" ON "LocalizacaoLoja"("localizacaoId", "lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioLocalizacao_usuarioId_localizacaoId_key" ON "UsuarioLocalizacao"("usuarioId", "localizacaoId");

-- AddForeignKey
ALTER TABLE "Endereco" ADD CONSTRAINT "Endereco_localizacaoId_fkey" FOREIGN KEY ("localizacaoId") REFERENCES "Localizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalizacaoLoja" ADD CONSTRAINT "LocalizacaoLoja_localizacaoId_fkey" FOREIGN KEY ("localizacaoId") REFERENCES "Localizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalizacaoLoja" ADD CONSTRAINT "LocalizacaoLoja_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioLocalizacao" ADD CONSTRAINT "UsuarioLocalizacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioLocalizacao" ADD CONSTRAINT "UsuarioLocalizacao_localizacaoId_fkey" FOREIGN KEY ("localizacaoId") REFERENCES "Localizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
