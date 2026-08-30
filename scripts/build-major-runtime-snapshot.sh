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
# shellcheck source=scripts/major-clone-tree.sh
source "$ROOT/scripts/major-clone-tree.sh"
ACCOUNT_HOME="$(python3 - <<'PY'
import os
import pwd
from pathlib import Path
print(Path(pwd.getpwuid(os.getuid()).pw_dir).resolve())
PY
)"

if [ "$DEST" = / ] || [ "$DEST" = "$ROOT" ] || [ "$DEST" = "$ACCOUNT_HOME" ] || \
  { [ -n "${HOME:-}" ] && [ "$DEST" = "$HOME" ]; }; then
  echo "ERROR: refusing unsafe runtime snapshot destination: $DEST" >&2
  exit 2
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$DEST/"
major_clone_or_copy "$ROOT/dist" "$DEST/dist"
major_clone_or_copy "$ROOT/drizzle" "$DEST/drizzle"
major_clone_or_copy "$ROOT/guidance" "$DEST/guidance"
major_clone_or_copy "$ROOT/skills" "$DEST/skills"
major_clone_or_copy "$ROOT/evals" "$DEST/evals"
major_clone_or_copy "$ROOT/scripts" "$DEST/scripts"
major_clone_or_copy "$ROOT/templates" "$DEST/templates"
major_clone_or_copy "$ROOT/adapters" "$DEST/adapters"
major_clone_or_copy "$ROOT/config/vale" "$DEST/config/vale"

MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
LOCK_HASH="$(shasum -a 256 "$DEST/pnpm-lock.yaml" | awk '{print $1}')"
DONOR=""
for dir in "$MAJOR_HOME/releases"/* "$MAJOR_HOME/staged-releases"/*; do
  [ -d "$dir/node_modules" ] && [ -f "$dir/pnpm-lock.yaml" ] || continue
  [ "$dir" = "$DEST" ] && continue
  if [ "$(shasum -a 256 "$dir/pnpm-lock.yaml" | awk '{print $1}')" = "$LOCK_HASH" ]; then
    DONOR="$dir"
    break
  fi
done
if [ -n "$DONOR" ]; then
  major_clone_or_copy "$DONOR/node_modules" "$DEST/node_modules"
else
  corepack pnpm install --prod --frozen-lockfile --dir "$DEST"
fi

# pnpm's package-manager metadata includes a build timestamp, and its generated
# executable shims embed the absolute installation path. Major imports its
# production dependencies as modules and never executes these package-manager
# shims. Exclude both non-runtime surfaces so an atomically relocated snapshot
# stays functional and deterministic.
rm -f "$DEST/node_modules/.modules.yaml" "$DEST/node_modules/.pnpm-workspace-state-v1.json"
find "$DEST/node_modules" -type d -name .bin -prune -exec rm -rf {} +

test -f "$DEST/dist/entry.js"
test -d "$DEST/drizzle"
test -f "$DEST/guidance/skills.registry.json"
test -f "$DEST/guidance/skills.catalog.json"
test -f "$DEST/adapters/skills/CODEX.md"
test -f "$DEST/config/vale/.vale.ini"
test -f "$DEST/config/vale/profiles/academic.ini"
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
test ! -e "$DEST/node_modules/.modules.yaml"
test ! -e "$DEST/node_modules/.pnpm-workspace-state-v1.json"
test -z "$(find "$DEST/node_modules" -type d -name .bin -print -quit)"

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
