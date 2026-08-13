#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE="${1:-}"
if [ -z "$CANDIDATE" ]; then
  echo "usage: verify-major-staged-candidate.sh <candidate-root>" >&2
  exit 2
fi
CANDIDATE="$(cd "$CANDIDATE" && pwd -P)"

test -z "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=all)" || {
  echo "ERROR: staged candidate source checkout is not clean" >&2
  exit 2
}
SOURCE_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_BRANCH="$(git -C "$SOURCE_ROOT" rev-parse --abbrev-ref HEAD)"
SOURCE_REPOSITORY="$(git -C "$SOURCE_ROOT" config --get remote.origin.url)"
SOURCE_TREE_OID="$(git -C "$SOURCE_ROOT" rev-parse HEAD^{tree})"
SOURCE_TREE_HASH="$(printf '%s' "$SOURCE_TREE_OID" | shasum -a 256 | awk '{print $1}')"
python3 - "$CANDIDATE/release.json" "$SOURCE_SHA" "$SOURCE_BRANCH" "$SOURCE_REPOSITORY" "$SOURCE_TREE_HASH" "$SOURCE_ROOT" <<'PY'
import json
from pathlib import Path
import sys
release = json.loads(Path(sys.argv[1]).read_text())
expected = {
    "version": "0.5.1",
    "sha": sys.argv[2],
    "branch": sys.argv[3],
    "repository": sys.argv[4],
    "treeHash": sys.argv[5],
    "sourceCheckout": str(Path(sys.argv[6]).resolve()),
}
if release != expected:
    raise SystemExit("ERROR: staged candidate release metadata does not match the bound source")
PY

VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/major-staged-verify.XXXXXX")"
cleanup() {
  rm -rf "$VERIFY_ROOT"
}
trap cleanup EXIT

corepack pnpm --dir "$SOURCE_ROOT" build >/dev/null
bash "$SOURCE_ROOT/scripts/build-major-runtime-snapshot.sh" "$VERIFY_ROOT/runtime" >/dev/null
chmod u+w "$VERIFY_ROOT/runtime/runtime-manifest.json"
cp "$CANDIDATE/release.json" "$VERIFY_ROOT/runtime/release.json"
cat > "$VERIFY_ROOT/runtime/execution.json" <<EOF
{
  "backend": "lima",
  "instance": "major-worker-${SOURCE_SHA:0:12}",
  "limactlPath": "/opt/homebrew/bin/limactl",
  "isolationScope": "shared-workshop",
  "guestRunRoot": "/var/lib/major/runs"
}
EOF
chmod 0444 "$VERIFY_ROOT/runtime/execution.json"
node "$SOURCE_ROOT/scripts/major-runtime-manifest.mjs" create "$VERIFY_ROOT/runtime"
cmp -s "$VERIFY_ROOT/runtime/runtime-manifest.json" "$CANDIDATE/runtime-manifest.json" || {
  echo "ERROR: staged candidate bytes are not a deterministic snapshot of the bound source" >&2
  exit 2
}
