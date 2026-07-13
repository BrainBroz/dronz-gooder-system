#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="test"
export DATABASE_URL="${DATABASE_TEST_URL:-postgresql://postgres:postgres@localhost:5432/dronz_gooder_test?schema=public}"
export SEED_ADMIN_NAME="${SEED_ADMIN_NAME:-Test Admin}"
export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-change-me}"

prisma migrate deploy
tsx prisma/seed.ts
