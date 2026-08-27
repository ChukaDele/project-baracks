#!/usr/bin/env bash
# Deterministic source gate for the pinned DeepSeek Harness live workstation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "DSH FIELD VALIDATION FAILED: $*" >&2; exit 1; }

echo "DeepSeek Harness live-workstation validation"
echo "repo: $ROOT"

command -v node >/dev/null 2>&1 || fail "node is required"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v bash >/dev/null 2>&1 || fail "bash is required"
[[ -d node_modules ]] || fail "run pnpm install before validate:dsh"

echo "[1/4] Major static harness gate"
bash scripts/validate-major.sh

echo "[2/4] Harness runtime tests"
pnpm vitest run tests/harness-strangler.test.ts tests/dsh-runtime-routing.test.ts \
  tests/dsh-major-kernel.test.ts tests/harness-workstation-app.test.ts

echo "[3/4] Major harness conformance"
MAJOR_HARNESS_ROOT="$ROOT" pnpm major harness conformance

echo "[4/4] Install dry-run"
bash scripts/install-deepseek-harness-pin.sh --dry-run

cat <<'EOF'

DSH source validation passed.
Normal trusted repository work defaults to headless Major host execution.
DSH Lima and legacy Major/Lima remain explicit compatibility choices.
EOF
