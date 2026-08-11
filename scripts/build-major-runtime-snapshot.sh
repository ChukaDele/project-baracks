#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-}"

if [ -z "$DEST" ]; then
  echo "usage: build-major-runtime-snapshot.sh <destination>" >&2
  exit 2
fi

DEST="$(python3 - "$DEST" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).expanduser().resolve())
PY
)"

case "$DEST" in
  /|"$HOME"|"$ROOT")
    echo "ERROR: refusing unsafe runtime snapshot destination: $DEST" >&2
    exit 2
    ;;
esac

rm -rf "$DEST"
mkdir -p "$DEST/scripts"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$DEST/"
cp -R "$ROOT/dist" "$DEST/dist"
cp -R "$ROOT/drizzle" "$DEST/drizzle"
cp "$ROOT/scripts/major-antigravity-worker.py" "$DEST/scripts/major-antigravity-worker.py"

pnpm install --prod --frozen-lockfile --dir "$DEST"

test -f "$DEST/dist/entry.js"
test -d "$DEST/drizzle"
test -f "$DEST/scripts/major-antigravity-worker.py"
test -d "$DEST/node_modules"

# Runtime smoke: execute from the immutable snapshot with isolated Major state.
SMOKE_HOME="$DEST/.smoke-major-home"
mkdir -p "$SMOKE_HOME"
MAJOR_HOME="$SMOKE_HOME" node "$DEST/dist/entry.js" status >/dev/null

# Migration smoke: prove the packaged drizzle migrations are discoverable from
# the snapshot and can initialize a fresh SQLite database.
MAJOR_HOME="$SMOKE_HOME" MAJOR_DB_PATH="$SMOKE_HOME/major.db" node --input-type=module - "$DEST" <<'NODE'
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.argv[2];
const moduleUrl = pathToFileURL(resolve(root, 'dist/db/client.js')).href;
const mod = await import(moduleUrl);
const opened = mod.openDb();
opened.sqlite.close();
NODE

rm -rf "$SMOKE_HOME"
echo "Major immutable runtime snapshot smoke passed: $DEST"
