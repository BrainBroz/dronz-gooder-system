-- D-17: compensação patrimonial proposta por um usuário e aplicada só com aval de outro.
-- CreateEnum
CREATE TYPE "StatusSolicitacaoCorrecao" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA');

-- CreateTable
CREATE TABLE "SolicitacaoCorrecao" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StatusSolicitacaoCorrecao" NOT NULL DEFAULT 'PENDENTE',
    "propostoPorId" TEXT NOT NULL,
    "decididoPorId" TEXT,
    "decididoEm" TIMESTAMP(3),
    "motivoDecisao" TEXT,
    "eventoCorretivoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolicitacaoCorrecao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolicitacaoCorrecao_lojaId_status_idx" ON "SolicitacaoCorrecao"("lojaId", "status");

-- AddForeignKey
ALTER TABLE "SolicitacaoCorrecao" ADD CONSTRAINT "SolicitacaoCorrecao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoCorrecao" ADD CONSTRAINT "SolicitacaoCorrecao_propostoPorId_fkey" FOREIGN KEY ("propostoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitacaoCorrecao" ADD CONSTRAINT "SolicitacaoCorrecao_decididoPorId_fkey" FOREIGN KEY ("decididoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
