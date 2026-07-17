#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
git -C "$repo_root" config --local core.hooksPath .githooks
chmod +x "$repo_root/.githooks/post-commit" "$repo_root/scripts/run-local-agent-review.sh"

printf '%s\n' 'Local agent-review hook enabled.'
printf '%s\n' 'Use the commit trailer: Agent-Review: required'
