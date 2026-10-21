-- CreateEnum
CREATE TYPE "FinalidadeConexao" AS ENUM ('LOJA', 'PESSOAL');

-- AlterTable
ALTER TABLE "ConexaoMarketplace" ADD COLUMN     "finalidade" "FinalidadeConexao" NOT NULL DEFAULT 'LOJA';
