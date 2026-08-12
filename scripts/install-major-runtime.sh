#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
MAJOR_HOME="$HOME/.major"
RELEASES_DIR="$MAJOR_HOME/releases"
LEGACY_PLIST="$HOME/Library/LaunchAgents/com.chuka.major-supervisor.plist"
RELEASE_RECORD="$MAJOR_HOME/installed-release.json"
LEGACY_SERVICE="gui/$UID/com.chuka.major-supervisor"
LEGACY_WAS_LOADED=0
LEGACY_STOPPED=0
INSTALL_COMMITTED=0
LEARNING_MIGRATION_LOCK="$MAJOR_HOME/learning/.migration.lock"
LEARNING_LOCK_HELD=0
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "ERROR: refusing to install Major from a dirty checkout." >&2
  echo "Commit, stash or remove local changes first." >&2
  exit 1
fi

INSTALL_SHA="$(git rev-parse HEAD)"
INSTALL_BRANCH="$(git branch --show-current 2>/dev/null || true)"
INSTALL_BRANCH="${INSTALL_BRANCH:-detached}"
INSTALL_VERSION="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync('package.json','utf8')).version)")"
RELEASE_DIR="$RELEASES_DIR/$INSTALL_SHA"
INSTALL_STAGE=""
RELEASE_CREATED=0

cleanup() {
  local status=$?
  [ -z "$INSTALL_STAGE" ] || rm -rf "$INSTALL_STAGE"
  if [ "$LEARNING_LOCK_HELD" = "1" ]; then
    rm -f "$LEARNING_MIGRATION_LOCK"
  fi
  if [ "$status" -ne 0 ] && [ "$RELEASE_CREATED" = "1" ]; then
    rm -rf "$RELEASE_DIR"
  fi
  if [ "$status" -ne 0 ] && [ "$LEGACY_WAS_LOADED" = "1" ] && \
     [ "$LEGACY_STOPPED" = "1" ] && [ "$INSTALL_COMMITTED" = "0" ] && \
     [ -f "$LEGACY_PLIST" ]; then
    if ! launchctl bootstrap "gui/$UID" "$LEGACY_PLIST" >/dev/null 2>&1; then
      echo "CRITICAL: Major restored the prior files but could not restart the legacy supervisor." >&2
      echo "Run: launchctl bootstrap gui/$UID '$LEGACY_PLIST'" >&2
    fi
  fi
}
trap cleanup EXIT

if [ "$INSTALL_BRANCH" != "main" ]; then
  echo "ERROR: refusing to install Major from branch '$INSTALL_BRANCH'." >&2
  echo "Install releases from main after green CI." >&2
  exit 1
fi

git fetch --quiet origin main
REMOTE_MAIN_SHA="$(git rev-parse refs/remotes/origin/main)"
if [ "$INSTALL_SHA" != "$REMOTE_MAIN_SHA" ]; then
  echo "ERROR: refusing to install Major because local HEAD is not the current origin/main." >&2
  echo "local:  $INSTALL_SHA" >&2
  echo "remote: $REMOTE_MAIN_SHA" >&2
  echo "Pull the green main release first." >&2
  exit 1
fi

corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

echo "Running Major release gate before installation..."
INSTALL_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/major-runtime-install.XXXXXX")"
bash scripts/validate-major-release.sh "$INSTALL_STAGE/runtime"

# Never delete a release directory that an already-installed wrapper may still
# be using. A same-SHA reinstall reuses a complete existing snapshot; an
# incomplete same-SHA directory is treated as corruption and must be inspected.
if [ -d "$RELEASE_DIR" ]; then
  if [ ! -f "$RELEASE_DIR/release.json" ] || \
     [ ! -f "$RELEASE_DIR/dist/entry.js" ] || \
     [ ! -d "$RELEASE_DIR/drizzle" ] || \
     [ ! -d "$RELEASE_DIR/node_modules" ]; then
    echo "ERROR: existing Major release snapshot is incomplete: $RELEASE_DIR" >&2
    echo "Do not overwrite it automatically; inspect/remove the corrupt inactive snapshot and reinstall." >&2
    exit 1
  fi
  EXISTING_SHA="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).sha || '')" "$RELEASE_DIR/release.json")"
  if [ "$EXISTING_SHA" != "$INSTALL_SHA" ]; then
    echo "ERROR: existing release directory SHA mismatch at $RELEASE_DIR" >&2
    exit 1
  fi
fi

WRAPPER_TMP="$INSTALL_STAGE/major"
RECORD_TMP="$INSTALL_STAGE/installed-release.json"
RULES_RECORD_TMP="$INSTALL_STAGE/installed-global-rules.json"

# Build and execute-smoke the same immutable runtime shape used in production.
if [ ! -d "$RELEASE_DIR" ]; then
  cat > "$INSTALL_STAGE/runtime/release.json" <<EOF
{
  "version": "$INSTALL_VERSION",
  "sha": "$INSTALL_SHA",
  "branch": "$INSTALL_BRANCH"
}
EOF
  mkdir -p "$BIN_DIR" "$RELEASES_DIR"
  mv "$INSTALL_STAGE/runtime" "$RELEASE_DIR"
  RELEASE_CREATED=1
fi

cat > "$WRAPPER_TMP" <<EOF
#!/bin/sh
set -eu
exec node "$RELEASE_DIR/dist/entry.js" "\$@"
EOF
chmod +x "$WRAPPER_TMP"

python3 - "$RECORD_TMP" "$INSTALL_VERSION" "$INSTALL_SHA" "$INSTALL_BRANCH" "$RELEASE_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
record = {
    "version": sys.argv[2],
    "sha": sys.argv[3],
    "branch": sys.argv[4],
    "releaseDir": sys.argv[5],
    "installedAt": datetime.now(timezone.utc).isoformat(),
    "releaseGate": "passed",
    "runtimeImmutableSnapshot": True,
}
path.write_text(json.dumps(record, indent=2) + "\n")
PY

python3 - "$RULES_RECORD_TMP" "$INSTALL_SHA" "$INSTALL_BRANCH" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(
    json.dumps(
        {
            "sha": sys.argv[2],
            "branch": sys.argv[3],
            "installedAt": datetime.now(timezone.utc).isoformat(),
            "preflightBypasses": [],
        },
        indent=2,
    )
    + "\n"
)
PY

# A loaded legacy service survives deletion of its plist. Stop the exact
# service before activation, while the old plist remains available for a
# rollback restart. Stop it before staging so it cannot mutate legacy learning
# state after the migration snapshot is taken.
if launchctl print "$LEGACY_SERVICE" >/dev/null 2>&1; then
  LEGACY_WAS_LOADED=1
  if ! launchctl bootout "$LEGACY_SERVICE" >/dev/null 2>&1; then
    echo "ERROR: refusing to install Major because the legacy supervisor could not be stopped." >&2
    exit 1
  fi
  LEGACY_STOPPED=1
fi

# Prevent current Major writers from changing learning state between staging
# and activation. Reclaim only an old lock with no live owning process.
mkdir -p "$MAJOR_HOME/learning"
if ! python3 "$ROOT/scripts/acquire-major-learning-migration-lock.py" "$LEARNING_MIGRATION_LOCK" "$$"; then
  exit 1
fi
LEARNING_LOCK_HELD=1

# The user-level installation is one rollback-capable transaction. The old
# wrapper and every existing rule/settings file remain recoverable until all
# replacements have completed.
MANIFEST="$(python3 "$ROOT/scripts/stage-major-user-state.py" \
  --root "$ROOT" \
  --stage "$INSTALL_STAGE/user-state" \
  --major-bin "$BIN_DIR/major" \
  --record "$RECORD_TMP" \
  --global-rules-record "$RULES_RECORD_TMP" \
  --wrapper "$WRAPPER_TMP" \
  --legacy-plist "$LEGACY_PLIST")"

python3 "$ROOT/scripts/activate-major-user-state.py" --manifest "$MANIFEST"
RELEASE_CREATED=0
INSTALL_COMMITTED=1
rm -f "$LEARNING_MIGRATION_LOCK"
LEARNING_LOCK_HELD=0

# Pilot posture: no auto-start daemon. Never install or auto-start a global daemon.
if launchctl print "$LEGACY_SERVICE" >/dev/null 2>&1; then
  echo "CRITICAL: legacy Major supervisor is still loaded after installation." >&2
  exit 1
fi

# Ruflo is NOT attached globally. Provider CLIs are separate user tools. Major
# never installs or authenticates them as an unattended side effect.
if [ "${MAJOR_INSTALL_ANTIGRAVITY:-0}" = "1" ]; then
  echo "WARN: MAJOR_INSTALL_ANTIGRAVITY is retired. Install the official 'agy' CLI and complete Google OAuth interactively."
fi

cat <<EOF
Major v${INSTALL_VERSION} control plane installed from validated main.

CLI:        $BIN_DIR/major
Release:    $INSTALL_SHA ($INSTALL_BRANCH)
Runtime:    $RELEASE_DIR
Record:     $RELEASE_RECORD
State:      $MAJOR_HOME/supervisor-state.json
Policies:   $MAJOR_HOME/project-policies.json
Kill switch:$MAJOR_HOME/STOP
Claude:     deterministic SessionStart attach installed
Codex:      global Major rules installed
Cursor:     global Major rules installed
Antigravity:global Major rules installed

RUNTIME INTEGRITY:
- The active CLI runs from an immutable release snapshot under ~/.major/releases.
- The exact snapshot builder is smoke-tested, including production dependencies, DB migrations and required runtime helpers.
- Editing, rebuilding, pulling or switching branches in project-baracks cannot silently change the installed runtime.
- Normal installs require clean main equal to current origin/main plus the complete local release gate.

NORMAL WORK MODE:
- Major is present by default across supported agent tools.
- The owner can explicitly fast-track trusted projects to foreground build mode.
- build = up to 6 useful workers, 120-minute coordinator ceiling, no repeated shadow/assist ceremony.
- --allow-external-writes authorizes normal project writes such as branches, PRs, previews and already-authorized integrations.
- client projects remain isolated from cross-project/global memory even in build mode.
- no new paid spend, destructive production-data changes, credential/ownership/DNS changes, or production security-policy changes without explicit authority.
- unattended/background mode is still separate from foreground build mode.

Owner-approved JSS working mode:
  major project configure jss-tool --class workshop --trust build --owner-approved --allow-external-writes

Owner-approved Surface Talent working mode:
  major project configure surface-talent --class client --trust build --owner-approved --allow-external-writes

Optional evidence-first mode for any new/untrusted project:
  major project configure <project> --class unknown --trust observe

Then work normally in a fresh Claude/Codex/Cursor session opened inside each repo.
No "start Major" prompt is required.

Emergency stop:
  major stop

Resume after inspection:
  major start
EOF
