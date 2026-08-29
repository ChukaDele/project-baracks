#!/usr/bin/env bash
set -euo pipefail

# Keep this shipped compatibility path on the same validation, immutable bundle
# identity, staging, host-artifact activation, and rollback contract as the CLI.
SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
SOURCE_ROOT="${1:-}"

if [ -n "$SOURCE_ROOT" ]; then
  SOURCE_ROOT="$(python3 - "$SOURCE_ROOT" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).expanduser().resolve())
PY
)"
  [ -d "$SOURCE_ROOT/skills/internal" ] || {
    echo "ERROR: skill source has no skills/internal: $SOURCE_ROOT" >&2
    exit 2
  }
  if ! git -C "$SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "ERROR: local skill source must be a git checkout so provenance is exact: $SOURCE_ROOT" >&2
    exit 1
  fi
  if [ -n "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=all)" ]; then
    echo "ERROR: refusing to sync Major skills from a dirty checkout: $SOURCE_ROOT" >&2
    exit 1
  fi
fi

if [ -f "$SCRIPT_ROOT/dist/entry.js" ]; then
  SYNC_COMMAND=(node "$SCRIPT_ROOT/dist/entry.js")
elif command -v major >/dev/null 2>&1; then
  SYNC_COMMAND=(major)
else
  echo "ERROR: canonical Major runtime is unavailable; build or install Major before syncing" >&2
  exit 1
fi

if [ -n "$SOURCE_ROOT" ]; then
  exec "${SYNC_COMMAND[@]}" skill sync --source "$SOURCE_ROOT"
fi
exec "${SYNC_COMMAND[@]}" skill sync
