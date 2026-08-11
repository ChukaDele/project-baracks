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
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate-major-install-transaction.py
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
bash scripts/build-major-runtime-snapshot.sh "$RUNTIME_DEST"

echo "Major canonical release validation passed."
