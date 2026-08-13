#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-}"
if [ -z "$DEST" ]; then
  echo "usage: stage-major-release-candidate.sh <destination>" >&2
  exit 2
fi
cd "$ROOT"
test -z "$(git status --porcelain --untracked-files=all)" || {
  echo "ERROR: candidate staging requires a clean checkout" >&2
  exit 2
}
SHA="$(git rev-parse HEAD)"
TREE_OID="$(git rev-parse HEAD^{tree})"
TREE_HASH="$(printf '%s' "$TREE_OID" | shasum -a 256 | awk '{print $1}')"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REPOSITORY="$(git config --get remote.origin.url)"
VERSION="$(node -p "require(process.argv[1]).version" "$ROOT/package.json")"
pnpm build
bash scripts/build-major-runtime-snapshot.sh "$DEST"
chmod u+w "$DEST/runtime-manifest.json"
python3 - "$DEST/release.json" "$VERSION" "$SHA" "$BRANCH" "$REPOSITORY" "$TREE_HASH" "$ROOT" <<'PY'
import json
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text(json.dumps({
    "version": sys.argv[2],
    "sha": sys.argv[3],
    "branch": sys.argv[4],
    "repository": sys.argv[5],
    "treeHash": sys.argv[6],
    "sourceCheckout": sys.argv[7],
}, indent=2) + "\n")
path.chmod(0o444)
PY
cat > "$DEST/execution.json" <<EOF
{
  "backend": "lima",
  "instance": "major-worker-${SHA:0:12}",
  "limactlPath": "/opt/homebrew/bin/limactl",
  "isolationScope": "shared-workshop",
  "guestRunRoot": "/var/lib/major/runs"
}
EOF
chmod 0444 "$DEST/execution.json"
node "$DEST/scripts/major-runtime-manifest.mjs" create "$DEST"
bash "$ROOT/scripts/verify-major-staged-candidate.sh" "$DEST"
echo "Major staged release candidate ready: $DEST ($SHA)"
