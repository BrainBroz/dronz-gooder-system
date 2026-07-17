#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
commit_sha="$(git rev-parse HEAD)"
base_ref="${AGENT_REVIEW_BASE:-origin/main}"
review_dir="$repo_root/.agents/reviews/$commit_sha"

if [ -n "$(git status --porcelain)" ]; then
  printf '%s\n' 'Local agent review requires a clean working tree.' >&2
  printf '%s\n' 'Commit or isolate pending changes before requesting review.' >&2
  exit 2
fi

if ! git rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null; then
  printf 'Review base not found: %s\n' "$base_ref" >&2
  exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
  printf '%s\n' 'Codex CLI is not available on PATH.' >&2
  exit 2
fi

mkdir -p "$review_dir"

cat > "$review_dir/metadata.md" <<EOF
# Local agent review (Codex)

- Commit: \`$commit_sha\`
- Base: \`$base_ref\`
- Branch: \`$(git branch --show-current)\`
- Subject: $(git log -1 --format=%s HEAD)
- Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

This report is generated locally and is not Git-tracked.
An execution status of zero is not an approval; inspect the findings in
codex.md before declaring the delivery complete.

Gemini via PAL/clink is optional, on-demand review for architecture and
documentation changes. It is not part of this per-commit gate — request it
explicitly when a batch changes contracts, architecture, or large documents.
EOF

diff_instruction="Run \`git diff $base_ref $commit_sha\` yourself in this repository to see the full change (it is not included below). Do not rely on assumptions about what changed."
codex_prompt="$diff_instruction Act only as an independent technical reviewer. Do not edit files, commit, push, merge, expose secrets, or infer unproven behavior. Audit tests, security, tenancy, contracts, regressions, and AGENTS.md. Write concise findings with severity, file and line where possible. Finish with exactly one verdict: APPROVED, APPROVED_WITH_NOTES, or CHANGES_REQUIRED."

set +e
codex -s read-only -a never exec "$codex_prompt" >"$review_dir/codex.md" 2>"$review_dir/codex.stderr"
codex_status=$?
set -e

if [ "$codex_status" -ne 0 ] || [ ! -s "$review_dir/codex.md" ]; then
  printf 'Codex review failed or produced no report. See %s/codex.stderr\n' "$review_dir" >&2
  exit 1
fi

printf 'Local Codex review finished: %s\n' "$review_dir"
