-- D-15: destino por pacote, herdando o destino do pedido quando nulo.
ALTER TABLE "PacoteExterno" ADD COLUMN "destinoPosicaoId" TEXT;

CREATE INDEX "PacoteExterno_destinoPosicaoId_idx" ON "PacoteExterno"("destinoPosicaoId");

ALTER TABLE "PacoteExterno" ADD CONSTRAINT "PacoteExterno_destinoPosicaoId_fkey" FOREIGN KEY ("destinoPosicaoId") REFERENCES "PosicaoOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
