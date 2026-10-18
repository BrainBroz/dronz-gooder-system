-- D-2/D-9/D-15/F-8: posições operacionais globais, responsabilidade contextual,
-- destino do pedido e reserva persistente. Migração compatível: a Base Miami
-- permanente é criada aqui e todo o histórico existente passa a apontar para ela.

CREATE TYPE "TipoPosicao" AS ENUM ('PERMANENTE', 'TEMPORARIA');
CREATE TYPE "StatusPosicao" AS ENUM ('CRIADA', 'ATIVA', 'ENCERRADA', 'CANCELADA');
CREATE TYPE "PapelResponsabilidade" AS ENUM ('PRINCIPAL', 'DELEGADO');
CREATE TYPE "StatusReservaMala" AS ENUM ('RESERVADA', 'CONSUMIDA');

CREATE TABLE "Local" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "estado" TEXT,
    "pais" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "endereco" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Local_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PosicaoOperacional" (
    "id" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoPosicao" NOT NULL,
    "status" "StatusPosicao" NOT NULL DEFAULT 'CRIADA',
    "inicioEm" TIMESTAMP(3),
    "fimEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosicaoOperacional_pkey" PRIMARY KEY ("id"),
    -- Temporária exige período; permanente não termina por data.
    CONSTRAINT "PosicaoOperacional_periodo_check" CHECK (
      ("tipo" = 'TEMPORARIA' AND "inicioEm" IS NOT NULL AND "fimEm" IS NOT NULL AND "fimEm" > "inicioEm")
      OR ("tipo" = 'PERMANENTE' AND "fimEm" IS NULL)
    )
);

CREATE TABLE "ResponsabilidadeContextual" (
    "id" TEXT NOT NULL,
    "posicaoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "papel" "PapelResponsabilidade" NOT NULL,
    "validoDe" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResponsabilidadeContextual_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResponsabilidadeContextual_validade_check" CHECK ("validoAte" IS NULL OR "validoAte" > "validoDe")
);

CREATE UNIQUE INDEX "PosicaoOperacional_codigo_key" ON "PosicaoOperacional"("codigo");
CREATE INDEX "PosicaoOperacional_status_idx" ON "PosicaoOperacional"("status");
CREATE INDEX "ResponsabilidadeContextual_posicaoId_usuarioId_idx" ON "ResponsabilidadeContextual"("posicaoId", "usuarioId");

ALTER TABLE "PosicaoOperacional" ADD CONSTRAINT "PosicaoOperacional_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResponsabilidadeContextual" ADD CONSTRAINT "ResponsabilidadeContextual_posicaoId_fkey" FOREIGN KEY ("posicaoId") REFERENCES "PosicaoOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResponsabilidadeContextual" ADD CONSTRAINT "ResponsabilidadeContextual_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Base Miami permanente (IDs estáveis referenciados pelos defaults abaixo).
INSERT INTO "Local" ("id", "alias", "cidade", "estado", "pais", "timezone", "updatedAt")
VALUES ('local-miami', 'Miami', 'Miami', 'FL', 'US', 'America/New_York', CURRENT_TIMESTAMP);
INSERT INTO "PosicaoOperacional" ("id", "localId", "codigo", "nome", "tipo", "status", "updatedAt")
VALUES ('posicao-miami-base', 'local-miami', 'MIAMI', 'Base Miami', 'PERMANENTE', 'ATIVA', CURRENT_TIMESTAMP);

ALTER TABLE "PedidoCompra" ADD COLUMN "destinoPosicaoId" TEXT NOT NULL DEFAULT 'posicao-miami-base';
ALTER TABLE "Mala" ADD COLUMN "posicaoId" TEXT NOT NULL DEFAULT 'posicao-miami-base';
ALTER TABLE "RecebimentoMiami" ADD COLUMN "posicaoId" TEXT NOT NULL DEFAULT 'posicao-miami-base';
ALTER TABLE "AlocacaoMala" ADD COLUMN "status" "StatusReservaMala" NOT NULL DEFAULT 'RESERVADA',
ADD COLUMN "reservadoPorId" TEXT,
ADD COLUMN "consumidaEm" TIMESTAMP(3);

-- Alocações de malas já fechadas representam composição consumida.
UPDATE "AlocacaoMala" a SET "status" = 'CONSUMIDA', "consumidaEm" = m."updatedAt"
FROM "Mala" m WHERE m."id" = a."malaId" AND m."status" <> 'PLANNING';

ALTER TABLE "PedidoCompra" ADD CONSTRAINT "PedidoCompra_destinoPosicaoId_fkey" FOREIGN KEY ("destinoPosicaoId") REFERENCES "PosicaoOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mala" ADD CONSTRAINT "Mala_posicaoId_fkey" FOREIGN KEY ("posicaoId") REFERENCES "PosicaoOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecebimentoMiami" ADD CONSTRAINT "RecebimentoMiami_posicaoId_fkey" FOREIGN KEY ("posicaoId") REFERENCES "PosicaoOperacional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AlocacaoMala" ADD CONSTRAINT "AlocacaoMala_reservadoPorId_fkey" FOREIGN KEY ("reservadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RecebimentoMiami_posicaoId_idx" ON "RecebimentoMiami"("posicaoId");
CREATE INDEX "Mala_posicaoId_idx" ON "Mala"("posicaoId");
