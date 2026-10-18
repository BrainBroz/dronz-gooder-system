-- D-4: condição do item no recebimento em dimensões separadas. Registros antigos ficam
-- NAO_DEFINIDA/NAO_TESTADO; a descrição original da divergência é preservada.
-- CreateEnum
CREATE TYPE "CondicaoComercial" AS ENUM ('NAO_DEFINIDA', 'NOVO', 'CAIXA_ABERTA', 'USADO');

-- CreateEnum
CREATE TYPE "Funcionamento" AS ENUM ('NAO_TESTADO', 'FUNCIONAL', 'DEFEITO_PARCIAL', 'INOPERANTE');

-- AlterTable
ALTER TABLE "RecebimentoMiami" ADD COLUMN     "acessoriosAusentes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "condicaoComercial" "CondicaoComercial" NOT NULL DEFAULT 'NAO_DEFINIDA',
ADD COLUMN     "funcionamento" "Funcionamento" NOT NULL DEFAULT 'NAO_TESTADO',
ADD COLUMN     "observacaoCondicao" TEXT,
ADD COLUMN     "registroTerceiro" BOOLEAN NOT NULL DEFAULT false;
