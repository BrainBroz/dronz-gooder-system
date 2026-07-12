#!/usr/bin/env bash
set -euo pipefail

export PATH="$(brew --prefix postgresql@16)/bin:/opt/homebrew/opt/node@22/bin:$PATH"
DB_NAME="dronz_gooder_ui3c_migration_test"
DB_URL="postgresql://postgres:postgres@localhost:5432/${DB_NAME}?schema=public"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"

cleanup() {
  PGPASSWORD=postgres dropdb -h localhost -U postgres --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

PGPASSWORD=postgres dropdb -h localhost -U postgres --if-exists "$DB_NAME" >/dev/null 2>&1 || true
PGPASSWORD=postgres createdb -h localhost -U postgres -O postgres "$DB_NAME"

mkdir -p "$TMP/prisma/migrations"
cp "$ROOT/apps/api/prisma/schema.prisma" "$TMP/prisma/schema.prisma"
cp "$ROOT/apps/api/prisma/migrations/migration_lock.toml" "$TMP/prisma/migrations/migration_lock.toml"
for migration in "$ROOT"/apps/api/prisma/migrations/*; do
  name="$(basename "$migration")"
  if [[ -d "$migration" && "$name" != "20260712210000_ui3c_audit_fixes" ]]; then
    cp -R "$migration" "$TMP/prisma/migrations/$name"
  fi
done

DATABASE_URL="$DB_URL" npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null
DATABASE_URL="$DB_URL" SEED_ADMIN_NAME="Migration Test" SEED_ADMIN_EMAIL="admin@example.com" SEED_ADMIN_PASSWORD="change-me" \
  npx tsx "$ROOT/apps/api/prisma/seed.ts"

PGPASSWORD=postgres psql -h localhost -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Recebimento" ("id", "lojaId", "viagemId", "malaId", "status", "iniciadoEm", "concluidoEm", "confirmadoPorId", "createdAt", "updatedAt")
SELECT 'legacy-receipt', l."id", 'seed-trip-dronz', 'seed-suitcase-dronz', 'COMPLETED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Loja" l CROSS JOIN "Usuario" u WHERE l."slug" = 'dronz' AND u."email" = 'admin@example.com';

INSERT INTO "RecebimentoItem" ("id", "lojaId", "recebimentoId", "pedidoCompraItemId", "produtoId", "quantidadeEsperada", "quantidadeRecebida", "quantidadeRejeitada", "quantidadeJaIncorporada", "createdAt", "updatedAt")
SELECT 'legacy-receipt-item', p."lojaId", 'legacy-receipt', p."id", p."produtoId", 2, 2, 0, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PedidoCompraItem" p JOIN "PedidoCompra" o ON o."id" = p."pedidoCompraId" WHERE o."numeroPedido" = 'SEED-DRONZ-001';

UPDATE "Estoque" SET "quantidadeFisica" = 4, "quantidadeReservada" = 0, "updatedAt" = CURRENT_TIMESTAMP
WHERE "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'dronz')
  AND "produtoId" = (SELECT "id" FROM "Produto" WHERE "codigo" = 101);

INSERT INTO "MovimentacaoEstoque" ("id", "lojaId", "produtoId", "estoqueId", "recebimentoId", "tipo", "motivo", "quantidade", "quantidadeAnterior", "quantidadePosterior", "responsavelId", "createdAt")
SELECT movement.id, l."id", p."id", e."id", 'legacy-receipt', 'ENTRY', 'PURCHASE_RECEIPT', 2, movement.before_qty, movement.after_qty, u."id", movement.created_at
FROM "Loja" l CROSS JOIN "Produto" p CROSS JOIN "Usuario" u JOIN "Estoque" e ON e."lojaId" = l."id" AND e."produtoId" = p."id"
CROSS JOIN (VALUES ('legacy-entry-1', 0, 2, CURRENT_TIMESTAMP - INTERVAL '1 minute'), ('legacy-entry-2', 2, 4, CURRENT_TIMESTAMP)) AS movement(id, before_qty, after_qty, created_at)
WHERE l."slug" = 'dronz' AND p."codigo" = 101 AND u."email" = 'admin@example.com';
SQL

cp -R "$ROOT/apps/api/prisma/migrations/20260712210000_ui3c_audit_fixes" "$TMP/prisma/migrations/20260712210000_ui3c_audit_fixes"
DATABASE_URL="$DB_URL" npx prisma migrate deploy --schema "$TMP/prisma/schema.prisma" >/dev/null

PGPASSWORD=postgres psql -h localhost -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT e."quantidadeFisica" FROM "Estoque" e JOIN "Loja" l ON l."id" = e."lojaId" JOIN "Produto" p ON p."id" = e."produtoId" WHERE l."slug" = 'dronz' AND p."codigo" = 101) <> 2 THEN
    RAISE EXCEPTION 'saldo legado não foi reconciliado';
  END IF;
  IF (SELECT COUNT(*) FROM "MovimentacaoEstoque" WHERE "recebimentoId" = 'legacy-receipt' AND "tipo" = 'ENTRY') <> 2 THEN
    RAISE EXCEPTION 'histórico de ENTRY foi perdido';
  END IF;
  IF (SELECT COALESCE(SUM("quantidade"), 0) FROM "MovimentacaoEstoque" WHERE "recebimentoId" = 'legacy-receipt' AND "tipo" = 'ADJUSTMENT_NEGATIVE') <> 2 THEN
    RAISE EXCEPTION 'movimento compensatório da migration incorreto';
  END IF;
END $$;
SQL

echo "UI3C migration upgrade test passed"
