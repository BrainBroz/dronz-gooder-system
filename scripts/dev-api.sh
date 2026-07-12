#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Arquivo .env ausente. Crie-o a partir de .env.example." >&2
  exit 1
fi

set -a
source .env
set +a

exec npm run dev --workspace @dronz-gooder/api
