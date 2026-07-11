-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "authorizationVersion" INTEGER NOT NULL DEFAULT 0;

-- Migration is prepared for UsuarioLocalizacao scope enforcement (§11).
-- The UsuarioLocalizacao table is created in localizacao_endereco migration.
