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
INSTALL_LOCK="$MAJOR_HOME/.install.lock"
INSTALL_LOCK_HELD=0
WORKER_CREATED=0
WORKER_INSTANCE=""
AUTH_SOURCE_INSTANCE="major-worker"
AUTH_SOURCE_SHA=""
LIMACTL_PATH=""
INSTALL_STAGE=""
RELEASE_CREATED=0
RELEASE_DIR=""
BUILD_WORKTREE=""
cd "$ROOT"

acquire_install_lock() {
  mkdir -p "$MAJOR_HOME"
  if mkdir "$INSTALL_LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$INSTALL_LOCK/pid"
    INSTALL_LOCK_HELD=1
    return 0
  fi
  local owner=""
  [ ! -r "$INSTALL_LOCK/pid" ] || owner="$(tr -cd '0-9' < "$INSTALL_LOCK/pid")"
  if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
    rm -f "$INSTALL_LOCK/pid"
    rmdir "$INSTALL_LOCK" 2>/dev/null || true
    if mkdir "$INSTALL_LOCK" 2>/dev/null; then
      printf '%s\n' "$$" > "$INSTALL_LOCK/pid"
      INSTALL_LOCK_HELD=1
      return 0
    fi
  fi
  echo "ERROR: another Major installation transaction is active." >&2
  return 1
}
cleanup() {
  local status=$?
  [ -z "$INSTALL_STAGE" ] || rm -rf "$INSTALL_STAGE"
  if [ -n "$BUILD_WORKTREE" ]; then
    git worktree remove --force "$BUILD_WORKTREE" >/dev/null 2>&1 || true
  fi
  if [ "$LEARNING_LOCK_HELD" = "1" ]; then
    rm -f "$LEARNING_MIGRATION_LOCK"
  fi
  if [ "$status" -ne 0 ] && [ "$RELEASE_CREATED" = "1" ]; then
    rm -rf "$RELEASE_DIR"
  fi
  if [ "$status" -ne 0 ] && [ "$WORKER_CREATED" = "1" ] && [ -n "$LIMACTL_PATH" ]; then
    "$LIMACTL_PATH" stop --force "$WORKER_INSTANCE" >/dev/null 2>&1 || true
    if ! "$LIMACTL_PATH" delete --force "$WORKER_INSTANCE" >/dev/null 2>&1; then
      echo "CRITICAL: Major install rollback could not delete the new worker $WORKER_INSTANCE." >&2
    fi
  fi
  if [ "$status" -ne 0 ] && [ "$LEGACY_WAS_LOADED" = "1" ] && \
     [ "$LEGACY_STOPPED" = "1" ] && [ "$INSTALL_COMMITTED" = "0" ] && \
     [ -f "$LEGACY_PLIST" ]; then
    if ! launchctl bootstrap "gui/$UID" "$LEGACY_PLIST" >/dev/null 2>&1; then
      echo "CRITICAL: Major restored the prior files but could not restart the legacy supervisor." >&2
      echo "Run: launchctl bootstrap gui/$UID '$LEGACY_PLIST'" >&2
    fi
  fi
  if [ "$INSTALL_LOCK_HELD" = "1" ]; then
    rm -f "$INSTALL_LOCK/pid"
    rmdir "$INSTALL_LOCK" 2>/dev/null || \
      echo "WARNING: could not remove completed Major installer lock." >&2
  fi
}
trap cleanup EXIT

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
WORKER_INSTANCE="major-worker-${INSTALL_SHA:0:12}"
ACTIVATION_MODE="${MAJOR_ACTIVATION_MODE:-final-release}"
case "$ACTIVATION_MODE" in
  supervised-workshop|final-release) ;;
  *) echo "ERROR: MAJOR_ACTIVATION_MODE must be supervised-workshop or final-release" >&2; exit 2 ;;
esac
WORKSHOP_SESSION_ID=""
WORKSHOP_AUTH_CWD=""
if [ "$ACTIVATION_MODE" = supervised-workshop ]; then
  WORKSHOP_SESSION_ID="${MAJOR_WORKSHOP_SESSION_ID:-${CODEX_THREAD_ID:-}}"
  WORKSHOP_AUTH_CWD="$ROOT"
  if [ -z "$WORKSHOP_SESSION_ID" ]; then
    echo "ERROR: supervised Workshop installation requires an active session id" >&2
    exit 2
  fi
fi

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
acquire_install_lock

echo "Running Major release gate before installation..."
INSTALL_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/major-runtime-install.XXXXXX")"
BUILD_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/major-runtime-source.XXXXXX")"
rmdir "$BUILD_WORKTREE"
git worktree add --detach "$BUILD_WORKTREE" "$INSTALL_SHA" >/dev/null
(
  cd "$BUILD_WORKTREE"
  corepack enable >/dev/null 2>&1 || true
  corepack pnpm install --frozen-lockfile
  bash scripts/validate-major-release.sh "$INSTALL_STAGE/runtime"
)
git worktree remove --force "$BUILD_WORKTREE"
BUILD_WORKTREE=""

# Never delete a release directory that an already-installed wrapper may still
# be using. A same-SHA reinstall reuses a complete existing snapshot; an
# incomplete same-SHA directory is treated as corruption and must be inspected.
if [ -d "$RELEASE_DIR" ]; then
  if [ ! -f "$RELEASE_DIR/release.json" ] || \
     [ ! -f "$RELEASE_DIR/dist/entry.js" ] || \
     [ ! -d "$RELEASE_DIR/drizzle" ] || \
     [ ! -d "$RELEASE_DIR/node_modules" ] || \
     [ ! -f "$RELEASE_DIR/runtime-manifest.json" ]; then
    echo "ERROR: existing Major release snapshot is incomplete: $RELEASE_DIR" >&2
    echo "Do not overwrite it automatically; inspect/remove the corrupt inactive snapshot and reinstall." >&2
    exit 1
  fi
  EXISTING_SHA="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).sha || '')" "$RELEASE_DIR/release.json")"
  if [ "$EXISTING_SHA" != "$INSTALL_SHA" ]; then
    echo "ERROR: existing release directory SHA mismatch at $RELEASE_DIR" >&2
    exit 1
  fi
  if ! node "$RELEASE_DIR/scripts/major-runtime-manifest.mjs" verify "$RELEASE_DIR"; then
    echo "ERROR: existing Major release snapshot failed its content manifest: $RELEASE_DIR" >&2
    exit 1
  fi
fi

WRAPPER_TMP="$INSTALL_STAGE/major"
RECORD_TMP="$INSTALL_STAGE/installed-release.json"
RULES_RECORD_TMP="$INSTALL_STAGE/installed-global-rules.json"
EXECUTION_CONFIG_TMP="$INSTALL_STAGE/execution.json"

LIMACTL_PATH="$(command -v limactl || true)"
if [ -z "$LIMACTL_PATH" ]; then
  echo "ERROR: Lima 2.2.x is required for Major provider execution." >&2
  echo "Install Lima, then rerun the Major installer." >&2
  exit 1
fi
LIMACTL_PATH="$(python3 - "$LIMACTL_PATH" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).resolve())
PY
)"
if ! "$LIMACTL_PATH" --version | grep -Eq '(^|[^0-9])2\.2\.[0-9]+'; then
  echo "ERROR: Major requires Lima >=2.2.0 and <2.3.0." >&2
  exit 1
fi
python3 - "$INSTALL_STAGE/runtime/templates/major/execution.json" "$EXECUTION_CONFIG_TMP" "$LIMACTL_PATH" "$WORKER_INSTANCE" <<'PY'
import json
import sys
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text())
config["limactlPath"] = sys.argv[3]
config["instance"] = sys.argv[4]
Path(sys.argv[2]).write_text(json.dumps(config, indent=2) + "\n")
PY

# Provision and verify a release-specific isolated worker before changing the
# active wrapper or user state. The current release's worker is never mutated.
WORKER_LIST_TMP="$INSTALL_STAGE/worker-list.jsonl"
if ! "$LIMACTL_PATH" list --json > "$WORKER_LIST_TMP"; then
  echo "ERROR: could not inspect existing Major Lima workers; refusing installation." >&2
  exit 1
fi
set +e
python3 -c '
import json, sys
name = sys.argv[1]
rows = [json.loads(line) for line in sys.stdin if line.strip()]
raise SystemExit(0 if any(row.get("name") == name for row in rows) else 3)
' "$WORKER_INSTANCE" < "$WORKER_LIST_TMP"
worker_inspection=$?
set -e
if [[ $worker_inspection -eq 3 ]]; then
  WORKER_CREATED=1
elif [[ $worker_inspection -ne 0 ]]; then
  echo "ERROR: could not inspect existing Major Lima workers; refusing installation." >&2
  exit 1
fi
if [ -f "$MAJOR_HOME/execution.json" ] && [ ! -L "$MAJOR_HOME/execution.json" ] && \
   [ -f "$RELEASE_RECORD" ] && [ ! -L "$RELEASE_RECORD" ]; then
  AUTH_SOURCE_FIELDS="$(python3 - "$MAJOR_HOME/execution.json" "$RELEASE_RECORD" <<'PY'
import json
import re
import sys
from pathlib import Path

execution = json.loads(Path(sys.argv[1]).read_text())
release = json.loads(Path(sys.argv[2]).read_text())
instance = execution.get("instance", "")
sha = release.get("sha", "")
if not re.fullmatch(r"[0-9a-f]{40}", sha) or instance != f"major-worker-{sha[:12]}":
    raise SystemExit("ERROR: installed Major provider-auth source identity is invalid")
print(f"{instance}\t{sha}")
PY
)"
  IFS=$'\t' read -r AUTH_SOURCE_INSTANCE AUTH_SOURCE_SHA <<< "$AUTH_SOURCE_FIELDS"
  if [ "$AUTH_SOURCE_INSTANCE" = "$WORKER_INSTANCE" ]; then
    AUTH_SOURCE_INSTANCE="major-worker"
    AUTH_SOURCE_SHA=""
  fi
fi
MAJOR_PROVIDER_AUTH_SOURCE_INSTANCE="$AUTH_SOURCE_INSTANCE" \
MAJOR_PROVIDER_AUTH_SOURCE_SHA="$AUTH_SOURCE_SHA" \
MAJOR_WORKSHOP_AUTH_CWD="$WORKSHOP_AUTH_CWD" \
MAJOR_WORKSHOP_SESSION_ID="$WORKSHOP_SESSION_ID" \
  bash "$INSTALL_STAGE/runtime/scripts/provision-major-lima-worker.sh" \
    "$LIMACTL_PATH" "$WORKER_INSTANCE" "$INSTALL_SHA"

# Build and execute-smoke the same immutable runtime shape used in production.
if [ ! -d "$RELEASE_DIR" ]; then
  cat > "$INSTALL_STAGE/runtime/release.json" <<EOF
{
  "version": "$INSTALL_VERSION",
  "sha": "$INSTALL_SHA",
  "branch": "$INSTALL_BRANCH"
}
EOF
  chmod 0644 "$INSTALL_STAGE/runtime/runtime-manifest.json"
  node "$INSTALL_STAGE/runtime/scripts/major-runtime-manifest.mjs" create "$INSTALL_STAGE/runtime"
  mkdir -p "$BIN_DIR" "$RELEASES_DIR"
  mv "$INSTALL_STAGE/runtime" "$RELEASE_DIR"
  RELEASE_CREATED=1
fi
SNAPSHOT_ROOT="$RELEASE_DIR"

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
  if launchctl print "$LEGACY_SERVICE" >/dev/null 2>&1; then
    echo "ERROR: refusing to install Major because the legacy supervisor is still loaded." >&2
    exit 1
  fi
fi

# Prevent current Major writers from changing learning state between staging
# and activation. Reclaim only an old lock with no live owning process.
mkdir -p "$MAJOR_HOME/learning"
if ! python3 "$SNAPSHOT_ROOT/scripts/acquire-major-learning-migration-lock.py" "$LEARNING_MIGRATION_LOCK" "$$"; then
  exit 1
fi
LEARNING_LOCK_HELD=1

# The user-level installation is one rollback-capable transaction. The old
# wrapper and every existing rule/settings file remain recoverable until all
# replacements have completed.
MANIFEST="$(python3 "$SNAPSHOT_ROOT/scripts/stage-major-user-state.py" \
  --root "$SNAPSHOT_ROOT" \
  --stage "$INSTALL_STAGE/user-state" \
  --major-bin "$BIN_DIR/major" \
  --record "$RECORD_TMP" \
  --global-rules-record "$RULES_RECORD_TMP" \
  --execution-config "$EXECUTION_CONFIG_TMP" \
  --wrapper "$WRAPPER_TMP" \
  --legacy-plist "$LEGACY_PLIST")"

python3 "$SNAPSHOT_ROOT/scripts/activate-major-user-state.py" --manifest "$MANIFEST"
RELEASE_CREATED=0
INSTALL_COMMITTED=1
WORKER_CREATED=0
rm -f "$LEARNING_MIGRATION_LOCK" || \
  echo "WARN: remove the completed Major learning migration lock: $LEARNING_MIGRATION_LOCK" >&2
LEARNING_LOCK_HELD=0

# Append-only install history so `major rollback` can identify the prior
# installed release without guessing from directory mtimes. Only written
# after activation actually committed — a failed/aborted install must never
# record a history entry for a release that never became active.
python3 - "$MAJOR_HOME/install-history.jsonl" "$RECORD_TMP" <<'PY'
import json
import sys
from pathlib import Path

history_path = Path(sys.argv[1])
record = json.loads(Path(sys.argv[2]).read_text())
with history_path.open('a') as handle:
    handle.write(json.dumps({
        "sha": record["sha"],
        "version": record["version"],
        "releaseDir": record["releaseDir"],
        "installedAt": record["installedAt"],
    }) + "\n")
PY

# Pilot posture: no auto-start daemon. Never install or auto-start a global daemon.
# The loaded-service postcondition was verified before activation so no
# fallible check remains after the user-state transaction commits.

# Ruflo is NOT attached globally. Provider CLIs are separate user tools. Major
# never installs or authenticates them as an unattended side effect.
if [ "${MAJOR_INSTALL_ANTIGRAVITY:-0}" = "1" ]; then
  echo "WARN: MAJOR_INSTALL_ANTIGRAVITY is retired. Install the official 'agy' CLI and complete Google OAuth interactively."
fi

# Copying files into place is not evidence the install actually works. Verify
# the now-active runtime's own content-hash manifest, then run a contained
# health check through the wrapper a user will actually invoke — not the
# build-time smoke test, the real installed CLI.
#
# installed-release.json and install-history.jsonl were already written by
# the point this runs (activation itself must complete before a live doctor
# check can even be attempted). A failure here must correct that record
# in place, not just exit — otherwise a support bundle or a maintainer
# reading installed-release.json afterward would see releaseGate: "passed"
# for a release this very script just refused to vouch for.
mark_release_gate_failed() {
  python3 "$SNAPSHOT_ROOT/scripts/mark-major-release-gate.py" "$RELEASE_RECORD" "$1"
}
echo
echo "Verifying the installed runtime..."
if ! node "$RELEASE_DIR/scripts/major-runtime-manifest.mjs" verify "$RELEASE_DIR"; then
  echo "ERROR: installed runtime failed its content manifest immediately after activation." >&2
  echo "Files were copied but the resulting runtime cannot be trusted; do not use this install." >&2
  mark_release_gate_failed "failed-content-manifest"
  exit 1
fi
POSTINSTALL_DOCTOR_STDERR="$(mktemp "${TMPDIR:-/tmp}/major-postinstall-doctor.XXXXXX")"
set +e
DOCTOR_JSON="$("$BIN_DIR/major" doctor --json 2>"$POSTINSTALL_DOCTOR_STDERR")"
DOCTOR_STATUS=$?
set -e
if [ "$DOCTOR_STATUS" -ne 0 ] && [ "$DOCTOR_STATUS" -ne 5 ]; then
  echo "ERROR: the installed major CLI failed its post-install health check (exit $DOCTOR_STATUS)." >&2
  cat "$POSTINSTALL_DOCTOR_STDERR" >&2
  rm -f "$POSTINSTALL_DOCTOR_STDERR"
  echo "Files were copied but the resulting runtime does not run cleanly; do not use this install." >&2
  mark_release_gate_failed "failed-post-install-health-check"
  exit 1
fi
rm -f "$POSTINSTALL_DOCTOR_STDERR"
CORE_READY="$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['data']['core']['ready'])" "$DOCTOR_JSON" 2>/dev/null || echo "unknown")"
DB_OK="$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])['data']
print('ok' if any(c['name']=='sqlite' and c['status']=='ok' for c in data['checks']) else 'FAILED')
" "$DOCTOR_JSON" 2>/dev/null || echo "unknown")"

cat <<EOF
Installed Major v${INSTALL_VERSION} ($INSTALL_SHA)

✓ release integrity  (content manifest verified)
✓ worker              (isolated runner core ready: $CORE_READY)
✓ database            ($DB_OK)
✓ provider setup available

Run:
  major setup

EOF

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
Codex:      global rules (AGENTS.md) + SessionStart hook installed (run '/hooks' once in Codex to trust it)
Cursor:     global rules (RULE.mdc) + sessionStart hook installed
Antigravity:global rules + PreInvocation attach hook installed via a registered plugin (~/.major/gemini-plugin)

RUNTIME INTEGRITY:
- The active CLI runs from an immutable release snapshot under ~/.major/releases.
- The exact snapshot builder is smoke-tested, including production dependencies, DB migrations and required runtime helpers.
- Editing, rebuilding, pulling or switching branches in project-baracks cannot silently change the installed runtime.
- Normal installs require clean main equal to current origin/main plus the complete local release gate.

NORMAL WORK MODE:
- Major is present by default across supported agent tools.
- The owner can explicitly fast-track trusted projects to foreground build mode.
- build = one concurrent worker on the shared v0.5.1 Lima runtime, 120-minute coordinator ceiling, no repeated shadow/assist ceremony.
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
