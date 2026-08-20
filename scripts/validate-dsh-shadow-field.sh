#!/usr/bin/env bash
# Deterministic shadow gate for the pinned DeepSeek Harness distribution.
# Validates source contract, harness tests, conformance CLI, and install dry-run.
# Does not claim READY: Lima install, /major field proof, and independent review remain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "DSH SHADOW FIELD VALIDATION FAILED: $*" >&2; exit 1; }

echo "DeepSeek Harness shadow field validation (source layer)"
echo "repo: $ROOT"

command -v node >/dev/null 2>&1 || fail "node is required"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v bash >/dev/null 2>&1 || fail "bash is required"

[[ -d node_modules ]] || fail "run pnpm install before validate:dsh-shadow"

echo "[1/5] Major static harness gate"
bash scripts/validate-major.sh

echo "[2/5] Harness strangler unit tests"
pnpm vitest run tests/harness-strangler.test.ts tests/dsh-major-kernel.test.ts

echo "[3/5] major harness conformance"
MAJOR_HARNESS_ROOT="$ROOT" pnpm major harness conformance

echo "[4/5] install dry-run (disk preflight + compose plan)"
bash scripts/install-deepseek-harness-pin.sh --dry-run

echo "[5/5] shadow-task smoke plan"
MAJOR_HARNESS_ROOT="$ROOT" pnpm major harness shadow-task

cat <<'EOF'

Shadow source validation passed.
Live workers remain on Lima + official CLI/ACP.

Next field proof (Mac workstation, not claimed by this script):
  1. bash scripts/install-deepseek-harness-pin.sh
  2. export MAJOR_SESSION_HOST=cursor   # or claude|codex|antigravity
  3. Run the smoke command from `major harness shadow-task`
  4. Inside Lima: one representative project task via /major
  5. Independent leaf review (exact-head-pr-review)

EOF
