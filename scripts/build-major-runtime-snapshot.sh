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
mkdir -p "$DEST"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$DEST/"
cp -R "$ROOT/dist" "$DEST/dist"
cp -R "$ROOT/drizzle" "$DEST/drizzle"
cp -R "$ROOT/guidance" "$DEST/guidance"
cp -R "$ROOT/skills" "$DEST/skills"
cp -R "$ROOT/evals" "$DEST/evals"
cp -R "$ROOT/scripts" "$DEST/scripts"
cp -R "$ROOT/templates" "$DEST/templates"

pnpm install --prod --frozen-lockfile --dir "$DEST"

test -f "$DEST/dist/entry.js"
test -d "$DEST/drizzle"
test -f "$DEST/guidance/skills.registry.json"
test -f "$DEST/skills/internal/skill-resolver/SKILL.md"
test -f "$DEST/evals/skill-resolver/skill-resolver.json"
test -x "$DEST/scripts/notify-human-blocker.sh"
test -x "$DEST/scripts/bootstrap-major-project.sh"
test -x "$DEST/scripts/install-major-skills.sh"
test -f "$DEST/scripts/major-ingest-youtube.sh"
test -f "$DEST/scripts/setup-major-knowledge-tools.sh"
test -f "$DEST/templates/project/ARCHITECTURE.md"
test -f "$DEST/templates/major/execution.json"
test -f "$DEST/templates/lima/major-worker.yaml"
test -f "$DEST/templates/apparmor/major-cursor-sandbox"
test -x "$DEST/scripts/bootstrap-major-lima-worker.sh"
test -f "$DEST/scripts/manage-major-provider-state.py"
test -x "$DEST/scripts/install-major-linux-providers.sh"
test -x "$DEST/scripts/provision-major-lima-worker.sh"
test -x "$DEST/scripts/major-runtime-manifest.mjs"
test -f "$DEST/scripts/validate-cursor-acp-field.mjs"
test -f "$DEST/scripts/validate-cli-provider-field.mjs"
test -f "$DEST/scripts/staged-field-support.mjs"
test -x "$DEST/scripts/create-secure-enclave-staged-validation-lease.mjs"
test -x "$DEST/scripts/install-secure-enclave-staged-validation-trust.sh"
test -x "$DEST/scripts/issue-secure-enclave-staged-validation-lease.sh"
test -f "$DEST/scripts/verify-secure-enclave-staged-validation-lease.mjs"
test -x "$DEST/scripts/stage-major-release-candidate.sh"
test -x "$DEST/scripts/verify-major-staged-candidate.sh"
test -f "$DEST/node_modules/@agentclientprotocol/sdk/package.json"
test -d "$DEST/node_modules"

# Runtime smoke: execute from the immutable snapshot with isolated Major state.
SMOKE_HOME="$DEST/.smoke-major-home"
mkdir -p "$SMOKE_HOME"
MAJOR_HOME="$SMOKE_HOME" node "$DEST/dist/entry.js" status >/dev/null
MAJOR_HOME="$SMOKE_HOME" node "$DEST/dist/entry.js" skill audit --json --strict >/dev/null

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

# Bind every packaged file, mode and symlink target to this snapshot.
node "$DEST/scripts/major-runtime-manifest.mjs" create "$DEST"
echo "Major immutable runtime snapshot smoke passed: $DEST"
