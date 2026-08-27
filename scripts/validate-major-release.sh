#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DEST="${1:-}"
RELEASE_TMP=""

cleanup() {
  [ -z "$RELEASE_TMP" ] || rm -rf "$RELEASE_TMP"
}
trap cleanup EXIT

if [ -z "$RUNTIME_DEST" ]; then
  RELEASE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/major-release-validation.XXXXXX")"
  RUNTIME_DEST="$RELEASE_TMP/runtime"
fi

cd "$ROOT"
bash scripts/validate-major.sh
bash scripts/validate-major-stability.sh
bash scripts/validate-provider-cli-contracts.sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate-major-install-transaction.py
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
bash scripts/build-major-runtime-snapshot.sh "$RUNTIME_DEST"

echo "Major canonical release validation passed."
