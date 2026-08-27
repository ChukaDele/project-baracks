#!/usr/bin/env bash
set -euo pipefail

# Activates the most recently installed release BEFORE the one currently
# active, reusing the exact same atomic user-state swap that
# install-major-runtime.sh uses (stage-major-user-state.py +
# activate-major-user-state.py) — this is not a second, parallel activation
# mechanism, it is the same one pointed at a different, already-built and
# already-validated release directory. No build, no re-provisioning: the
# prior release's runtime snapshot and worker were already proven when they
# were first installed; this only re-verifies their integrity still holds.

BIN_DIR="$HOME/.local/bin"
MAJOR_HOME="$HOME/.major"
RELEASE_RECORD="$MAJOR_HOME/installed-release.json"
HISTORY="$MAJOR_HOME/install-history.jsonl"
INSTALL_LOCK="$MAJOR_HOME/.install.lock"
INSTALL_LOCK_HELD=0
INSTALL_STAGE=""

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
  echo "ERROR: another Major installation/rollback transaction is active." >&2
  return 1
}
cleanup() {
  local status=$?
  [ -z "$INSTALL_STAGE" ] || rm -rf "$INSTALL_STAGE"
  if [ "$INSTALL_LOCK_HELD" = "1" ]; then
    rm -f "$INSTALL_LOCK/pid"
    rmdir "$INSTALL_LOCK" 2>/dev/null || \
      echo "WARNING: could not remove completed Major rollback lock." >&2
  fi
  return "$status"
}
trap cleanup EXIT

if [ ! -f "$RELEASE_RECORD" ]; then
  echo "ERROR: no installed release found; nothing to roll back from." >&2
  exit 1
fi
if [ ! -f "$HISTORY" ]; then
  echo "ERROR: no install history found; cannot identify a prior release." >&2
  echo "This Major install predates rollback tracking, or has never been updated." >&2
  exit 1
fi

CURRENT_SHA="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sha'])" "$RELEASE_RECORD")"
TARGET="$(python3 - "$HISTORY" "$CURRENT_SHA" <<'PY'
import json
import sys

history_path, current_sha = sys.argv[1], sys.argv[2]
entries = []
with open(history_path) as handle:
    for line in handle:
        line = line.strip()
        if line:
            entries.append(json.loads(line))
for entry in reversed(entries):
    if entry["sha"] != current_sha:
        print(json.dumps(entry))
        break
PY
)"
if [ -z "$TARGET" ]; then
  echo "ERROR: no prior release distinct from the current one ($CURRENT_SHA) was found in history." >&2
  exit 1
fi
TARGET_SHA="$(python3 -c "import json,sys; print(json.load(sys.stdin)['sha'])" <<<"$TARGET")"
TARGET_VERSION="$(python3 -c "import json,sys; print(json.load(sys.stdin)['version'])" <<<"$TARGET")"
TARGET_DIR="$(python3 -c "import json,sys; print(json.load(sys.stdin)['releaseDir'])" <<<"$TARGET")"

echo "Rolling back: $CURRENT_SHA -> $TARGET_SHA ($TARGET_VERSION)"

# Verify backup integrity before touching anything live.
if [ ! -f "$TARGET_DIR/release.json" ] || [ ! -f "$TARGET_DIR/dist/entry.js" ] || \
   [ ! -d "$TARGET_DIR/drizzle" ] || [ ! -d "$TARGET_DIR/node_modules" ] || \
   [ ! -f "$TARGET_DIR/runtime-manifest.json" ]; then
  echo "ERROR: prior release snapshot is incomplete: $TARGET_DIR" >&2
  echo "Refusing to roll back to a snapshot that cannot be verified." >&2
  exit 1
fi
if ! node "$TARGET_DIR/scripts/major-runtime-manifest.mjs" verify "$TARGET_DIR"; then
  echo "ERROR: prior release snapshot failed its content manifest: $TARGET_DIR" >&2
  echo "Refusing to roll back to a snapshot that may have been tampered with or corrupted." >&2
  exit 1
fi

TARGET_WORKER="major-worker-${TARGET_SHA:0:12}"
LIMACTL_PATH="$(command -v limactl || true)"
if [ -n "$LIMACTL_PATH" ]; then
  if ! "$LIMACTL_PATH" list --json 2>/dev/null | python3 -c "
import json, sys
name = sys.argv[1]
rows = [json.loads(line) for line in sys.stdin if line.strip()]
raise SystemExit(0 if any(row.get('name') == name for row in rows) else 1)
" "$TARGET_WORKER"; then
    echo "WARNING: the prior release's worker ($TARGET_WORKER) no longer exists." >&2
    echo "Provider credentials will need to be reconnected after rollback (major provider connect)." >&2
  fi
fi

acquire_install_lock
INSTALL_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/major-rollback.XXXXXX")"

WRAPPER_TMP="$INSTALL_STAGE/major"
RECORD_TMP="$INSTALL_STAGE/installed-release.json"
RULES_RECORD_TMP="$INSTALL_STAGE/installed-global-rules.json"
EXECUTION_CONFIG_TMP="$INSTALL_STAGE/execution.json"
EXECUTION_PATH="lima"
TARGET_BRANCH="$(python3 -c "import json; print(json.load(open('$TARGET_DIR/release.json')).get('branch','main'))")"

cat > "$WRAPPER_TMP" <<EOF
#!/bin/sh
set -eu
exec node "$TARGET_DIR/dist/entry.js" "\$@"
EOF
chmod +x "$WRAPPER_TMP"

python3 - "$RECORD_TMP" "$TARGET_VERSION" "$TARGET_SHA" "$TARGET_BRANCH" "$TARGET_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(json.dumps({
    "version": sys.argv[2],
    "sha": sys.argv[3],
    "branch": sys.argv[4],
    "releaseDir": sys.argv[5],
    "installedAt": datetime.now(timezone.utc).isoformat(),
    "releaseGate": "passed",
    "runtimeImmutableSnapshot": True,
    "rolledBackTo": True,
}, indent=2) + "\n")
PY

python3 - "$RULES_RECORD_TMP" "$TARGET_SHA" "$TARGET_BRANCH" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
path.write_text(json.dumps({
    "sha": sys.argv[2],
    "branch": sys.argv[3],
    "installedAt": datetime.now(timezone.utc).isoformat(),
    "preflightBypasses": [],
}, indent=2) + "\n")
PY

python3 - "$MAJOR_HOME/execution.json" "$EXECUTION_CONFIG_TMP" "$TARGET_WORKER" <<'PY'
import json
import sys
from pathlib import Path

current = json.loads(Path(sys.argv[1]).read_text()) if Path(sys.argv[1]).exists() else {
    "backend": "lima", "isolationScope": "shared-workshop", "guestRunRoot": "/var/lib/major/runs",
}
current["instance"] = sys.argv[3]
Path(sys.argv[2]).write_text(json.dumps(current, indent=2) + "\n")
PY

# Reuses the exact same atomic swap install uses: every touched file is
# backed up before replacement and restored automatically on interruption.
MANIFEST="$(python3 "$TARGET_DIR/scripts/stage-major-user-state.py" \
  --root "$TARGET_DIR" \
  --stage "$INSTALL_STAGE/user-state" \
  --major-bin "$BIN_DIR/major" \
  --record "$RECORD_TMP" \
  --global-rules-record "$RULES_RECORD_TMP" \
  --execution-path "$EXECUTION_PATH" \
  --execution-config "$EXECUTION_CONFIG_TMP" \
  --wrapper "$WRAPPER_TMP")"

python3 "$TARGET_DIR/scripts/activate-major-user-state.py" --manifest "$MANIFEST"

python3 - "$HISTORY" "$TARGET_SHA" "$TARGET_VERSION" "$TARGET_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone

history_path, sha, version, release_dir = sys.argv[1:5]
with open(history_path, 'a') as handle:
    handle.write(json.dumps({
        "sha": sha,
        "version": version,
        "releaseDir": release_dir,
        "installedAt": datetime.now(timezone.utc).isoformat(),
        "rollback": True,
    }) + "\n")
PY

echo "Rolled back to Major $TARGET_VERSION ($TARGET_SHA)."
echo
echo "Running major doctor to confirm the runtime is healthy..."
"$BIN_DIR/major" doctor || {
  echo "WARNING: major doctor reported issues after rollback; inspect the output above." >&2
  exit 1
}
