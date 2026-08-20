#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMACTL_PATH="${1:?usage: provision-major-lima-worker.sh <limactl-path> [instance]}"
INSTANCE="${2:-major-worker}"
RELEASE_SHA="${3:-legacy-v1}"
TEMPLATE="$ROOT/templates/lima/major-worker.yaml"
CREATED=0
AUTH_SOURCE_STARTED=0
AUTH_SOURCE_INSTANCE="${MAJOR_PROVIDER_AUTH_SOURCE_INSTANCE:-major-worker}"
AUTH_SOURCE_SHA="${MAJOR_PROVIDER_AUTH_SOURCE_SHA:-}"

# A previous-release worker used only as a credential source is not part of
# release integrity: its Lima transport can be unhealthy (e.g. a broken vsock
# forwarder retrying accept() in a tight, unbounded loop) independently of
# whether the worker itself is "Running". Every call touching that worker
# during migration is bounded, single-attempt (no hot retry), and has its
# stdout+stderr fully redirected to files instead of this script's own
# inherited descriptors.
#
# Redirecting stdout too (not just stderr) is required, not cosmetic: `limactl
# start`/`shell` can leave an orphaned grandchild running past the point where
# the tracked PID is killed (killing a process never kills its own children).
# If that orphan still held a reference to this script's inherited stdout, an
# EOF-waiting caller -- including a parent installer or a test harness reading
# this script's output through a pipe -- would hang forever waiting for a
# pipe close that an orphan neither triggers nor is capable of triggering.
# Funneling everything through plain files, which no lingering process needs
# to close for others to see EOF, sidesteps that regardless of what a broken
# Lima transport's orphan does after being cut loose.
AUTH_MIGRATION_LOG="$(mktemp "${TMPDIR:-/tmp}/major-auth-migration-log.XXXXXX")"
AUTH_CALL_STDOUT="$(mktemp "${TMPDIR:-/tmp}/major-auth-call-stdout.XXXXXX")"
AUTH_SOURCE_START_TIMEOUT_SECS="${MAJOR_AUTH_SOURCE_START_TIMEOUT_SECS:-60}"
AUTH_SOURCE_CALL_TIMEOUT_SECS="${MAJOR_AUTH_SOURCE_CALL_TIMEOUT_SECS:-30}"
BOUNDED_PID=""

# Runs "$@" with a hard deadline. stdout is captured to $AUTH_CALL_STDOUT
# (read it back with `cat "$AUTH_CALL_STDOUT"` when the caller needs the
# value) and stderr is appended to $AUTH_MIGRATION_LOG. Exit 124 means
# "timed out"; any other non-zero code is the command's own failure. Single
# attempt only -- never retries.
run_bounded() {
  local timeout_secs="$1"
  shift
  : >"$AUTH_CALL_STDOUT"
  "$@" >"$AUTH_CALL_STDOUT" 2>>"$AUTH_MIGRATION_LOG" &
  BOUNDED_PID=$!
  local pid=$BOUNDED_PID
  # Polled in tenths of a second so a call that finishes in milliseconds
  # (the overwhelmingly common case) doesn't pay a whole extra second of
  # dead latency just because the first liveness check always sees the
  # freshly-backgrounded process as still alive.
  local waited_tenths=0
  local limit_tenths=$((timeout_secs * 10))
  while kill -0 "$pid" 2>/dev/null; do
    if [[ $waited_tenths -ge $limit_tenths ]]; then
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      BOUNDED_PID=""
      echo "[run_bounded] timed out after ${timeout_secs}s: $*" >>"$AUTH_MIGRATION_LOG"
      return 124
    fi
    sleep 0.1
    waited_tenths=$((waited_tenths + 1))
  done
  local code=0
  wait "$pid" || code=$?
  BOUNDED_PID=""
  return "$code"
}

# On Ctrl+C (or a signal from an owning process) mid-migration, kill any
# in-flight bounded Lima call before the existing EXIT trap runs -- otherwise
# that call's background process would survive as an orphan.
on_interrupt() {
  if [[ -n "$BOUNDED_PID" ]] && kill -0 "$BOUNDED_PID" 2>/dev/null; then
    kill -TERM "$BOUNDED_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$BOUNDED_PID" 2>/dev/null || true
    wait "$BOUNDED_PID" 2>/dev/null || true
  fi
  exit 130
}
trap on_interrupt INT TERM

auth_migration_failed() {
  local cause="$1"
  echo "ERROR: previous Major worker failed to provide credentials for migration." >&2
  echo "Worker: $AUTH_SOURCE_INSTANCE" >&2
  echo "Cause: $cause" >&2
  echo "Existing release was not changed." >&2
  echo "Diagnostic log: $AUTH_MIGRATION_LOG" >&2
  echo "--- last 20 diagnostic lines ---" >&2
  tail -n 20 "$AUTH_MIGRATION_LOG" >&2 || true
  echo "After a successful install, reconnect any provider with: major provider connect <provider>" >&2
}

case "$INSTANCE" in
  major-worker|major-worker-[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;;
  *) echo "ERROR: unsupported Major Lima instance: $INSTANCE" >&2; exit 2 ;;
esac
if [[ "$INSTANCE" != major-worker && ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR: release-specific worker requires the full release SHA" >&2
  exit 2
fi
if [[ "$INSTANCE" != major-worker && "$INSTANCE" != "major-worker-${RELEASE_SHA:0:12}" ]]; then
  echo "ERROR: release worker name does not match the full release SHA" >&2
  exit 2
fi
case "$AUTH_SOURCE_INSTANCE" in
  major-worker) [[ -z "$AUTH_SOURCE_SHA" ]] || { echo "ERROR: legacy auth source cannot declare a release SHA" >&2; exit 2; } ;;
  major-worker-[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])
    [[ "$AUTH_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] && \
      [[ "$AUTH_SOURCE_INSTANCE" == "major-worker-${AUTH_SOURCE_SHA:0:12}" ]] || {
        echo "ERROR: release auth source requires its exact full SHA" >&2
        exit 2
      }
    ;;
  *) echo "ERROR: unsupported Major provider-auth source: $AUTH_SOURCE_INSTANCE" >&2; exit 2 ;;
esac
if [[ "$INSTANCE" != major-worker && "$AUTH_SOURCE_INSTANCE" == "$INSTANCE" ]]; then
  echo "ERROR: provider-auth source and destination must differ" >&2
  exit 2
fi

status() {
  "$LIMACTL_PATH" list --json | python3 -c '
import json, sys
name = sys.argv[1]
status = ""
for line in sys.stdin:
    if not line.strip(): continue
    row = json.loads(line)
    if row.get("name") == name:
        status = row.get("status", "")
print(status)
' "$INSTANCE"
}

validate_instance() {
  "$LIMACTL_PATH" list --json | python3 -c '
import json, sys
name = sys.argv[1]
rows = [json.loads(line) for line in sys.stdin if line.strip()]
row = next((item for item in rows if item.get("name") == name), None)
if row is None: raise SystemExit("instance missing")
config = row.get("config") or {}; ssh = config.get("ssh") or {}; containerd = config.get("containerd") or {}
violations = []
if row.get("vmType") != "vz": violations.append("vmType")
if row.get("arch") != "aarch64": violations.append("arch")
if row.get("sshAddress") != "127.0.0.1": violations.append("sshAddress")
if config.get("plain") is not True: violations.append("plain")
for field in ("mounts", "portForwards", "networks"):
    if config.get(field) not in (None, []): violations.append(field)
if config.get("propagateProxyEnv") is not False: violations.append("proxy")
if containerd.get("system") is not False or containerd.get("user") is not False: violations.append("containerd")
for field in ("forwardAgent", "forwardX11", "forwardX11Trusted", "loadDotSSHPubKeys"):
    if ssh.get(field) is not False: violations.append("ssh." + field)
if violations: raise SystemExit("unsafe existing Lima instance: " + ", ".join(violations))
' "$INSTANCE"
}

migrate_existing_auth() {
  [[ "$INSTANCE" == major-worker ]] && return 0
  local source_status provider relative authority_root workshop_authorized
  authority_root="${MAJOR_HOME:-$HOME/.major}/staged-validation/authorities/$RELEASE_SHA"
  check_source_status() {
    "$LIMACTL_PATH" list --json | python3 -c '
import json, sys
name = sys.argv[1]
status = ""
for line in sys.stdin:
    if not line.strip(): continue
    row = json.loads(line)
    if row.get("name") == name: status = row.get("status", "")
print(status)
' "$AUTH_SOURCE_INSTANCE"
  }
  # A failed or timed-out status lookup is treated the same as "not found":
  # nothing to migrate from, fail open rather than block the whole install.
  run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" check_source_status || true
  source_status="$(cat "$AUTH_CALL_STDOUT")"
  [[ -z "$source_status" ]] && return 0
  if [[ "$source_status" == Broken ]]; then
    echo "ERROR: refusing credential migration from broken $AUTH_SOURCE_INSTANCE" >&2
    return 1
  fi
  if [[ "$source_status" != Running ]]; then
    # Marked BEFORE attempting the start, not after it succeeds: a start call
    # that is killed by run_bounded's deadline (or by on_interrupt) may still
    # have brought the VM up, so restore_auth_source must try to stop it
    # either way rather than assuming an unconfirmed start never happened.
    AUTH_SOURCE_STARTED=1
    if ! run_bounded "$AUTH_SOURCE_START_TIMEOUT_SECS" "$LIMACTL_PATH" start "$AUTH_SOURCE_INSTANCE"; then
      restore_auth_source
      auth_migration_failed "Lima transport failed while starting $AUTH_SOURCE_INSTANCE (timed out after ${AUTH_SOURCE_START_TIMEOUT_SECS}s or exited abnormally)."
      return 1
    fi
  fi
  if [[ -n "$AUTH_SOURCE_SHA" ]]; then
    source_marker="/opt/major/releases/$AUTH_SOURCE_SHA"
    local marker_ok=1 marker_stat
    run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" shell --tty=false \
      "$AUTH_SOURCE_INSTANCE" sudo test -f "$source_marker" || marker_ok=0
    if [[ $marker_ok -eq 1 ]]; then
      run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" shell --tty=false \
        "$AUTH_SOURCE_INSTANCE" sudo test ! -L "$source_marker" || marker_ok=0
    fi
    if [[ $marker_ok -eq 1 ]]; then
      run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" shell --tty=false \
        "$AUTH_SOURCE_INSTANCE" sudo stat -c '%U:%G:%a' "$source_marker" || marker_ok=0
      marker_stat="$(cat "$AUTH_CALL_STDOUT")"
      [[ "$marker_stat" == "root:root:444" ]] || marker_ok=0
    fi
    if [[ $marker_ok -ne 1 ]]; then
      restore_auth_source
      echo "ERROR: provider-auth source release marker is missing or unsafe" >&2
      return 1
    fi
  fi
  # Stream only exact provider credentials covered by the current release's
  # independently signed, expiring Secure Enclave validation authority.
  # Missing credentials remain a provider-specific post-install step. Opaque
  # bytes are never printed, interpreted, or written to host storage.
  for entry in \
    'claude:claude/.claude/.credentials.json' \
    'codex:codex/.codex/auth.json' \
    'cursor:cursor/.config/cursor/auth.json' \
    'antigravity:antigravity/.gemini/antigravity-cli/antigravity-oauth-token'; do
    provider="${entry%%:*}"
    relative="${entry#*:}"
    workshop_authorized=0
    if [[ -n "${MAJOR_WORKSHOP_AUTH_CWD:-}" && -n "${MAJOR_WORKSHOP_SESSION_ID:-}" ]] && \
      node "$ROOT/dist/entry.js" session verify-handoff \
        --cwd "$MAJOR_WORKSHOP_AUTH_CWD" \
        --session-id "$MAJOR_WORKSHOP_SESSION_ID" \
        --provider "$provider" \
        --release-sha "$RELEASE_SHA" \
        --destination-instance "$INSTANCE" >/dev/null 2>&1; then
      workshop_authorized=1
    fi
    if [[ $workshop_authorized -ne 1 ]] && ! node "$ROOT/scripts/verify-secure-enclave-staged-validation-lease.mjs" \
      "$authority_root/major-staged-validation-lease.json" \
      "$authority_root/major-staged-validation-lease.json.sig" \
      "$RELEASE_SHA" credential-handoff "$provider" >/dev/null 2>&1; then
      continue
    fi
    local exists_code=0
    run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" shell --tty=false \
      "$AUTH_SOURCE_INSTANCE" sudo test -f "/var/lib/major/provider-auth/$relative" || exists_code=$?
    if [[ $exists_code -eq 124 ]]; then
      restore_auth_source
      auth_migration_failed "Lima transport failed while checking for the $provider credential on $AUTH_SOURCE_INSTANCE."
      return 1
    elif [[ $exists_code -ne 0 ]]; then
      continue
    fi
    exists_code=0
    run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" shell --tty=false \
      "$AUTH_SOURCE_INSTANCE" sudo test ! -L "/var/lib/major/provider-auth/$relative" || exists_code=$?
    if [[ $exists_code -eq 124 ]]; then
      restore_auth_source
      auth_migration_failed "Lima transport failed while checking for the $provider credential on $AUTH_SOURCE_INSTANCE."
      return 1
    elif [[ $exists_code -ne 0 ]]; then
      continue
    fi
    stream_credential_tar() {
      "$LIMACTL_PATH" shell --tty=false "$AUTH_SOURCE_INSTANCE" sudo tar \
          -C /var/lib/major/provider-auth -cf - "$relative" 2>>"$AUTH_MIGRATION_LOG" | \
        "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo tar \
          -C /var/lib/major/provider-auth -xf -
    }
    if ! run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" stream_credential_tar; then
      restore_auth_source
      echo "ERROR: exact $provider credential migration failed" >&2
      return 1
    fi
    if ! {
      "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo chown "root:major-$provider" \
        "/var/lib/major/provider-auth/$relative" &&
        "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo chmod 0440 \
          "/var/lib/major/provider-auth/$relative" &&
        "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo test \
          -f "/var/lib/major/provider-auth/$relative" &&
        "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo test \
          ! -L "/var/lib/major/provider-auth/$relative" &&
        [[ "$("$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo stat -c '%U:%G:%a' "/var/lib/major/provider-auth/$relative")" == "root:major-$provider:440" ]]
    }; then
      restore_auth_source
      echo "ERROR: migrated $provider credential failed destination validation" >&2
      return 1
    fi
  done
  restore_auth_source
}

restore_auth_source() {
  if [[ $AUTH_SOURCE_STARTED -eq 1 ]]; then
    # Bounded for the same reason every other auth-source call is: a broken
    # transport can make `stop` itself hang or spew exactly like `start` did.
    if ! run_bounded "$AUTH_SOURCE_CALL_TIMEOUT_SECS" "$LIMACTL_PATH" stop "$AUTH_SOURCE_INSTANCE"; then
      echo "CRITICAL: failed to restore provider-auth source $AUTH_SOURCE_INSTANCE to Stopped" >&2
      echo "Diagnostic log: $AUTH_MIGRATION_LOG" >&2
      return 1
    fi
    AUTH_SOURCE_STARTED=0
  fi
}

rollback() {
  local code="${1:-$?}"
  restore_auth_source || true
  if [[ $code -ne 0 && $CREATED -eq 1 ]]; then
    "$LIMACTL_PATH" stop --force "$INSTANCE" >/dev/null 2>&1 || true
    "$LIMACTL_PATH" delete --force "$INSTANCE" >/dev/null 2>&1 || \
      echo "CRITICAL: failed Major worker provisioning left a new partial instance: $INSTANCE" >&2
  fi
  return "$code"
}
trap 'rollback $?' EXIT

CURRENT="$(status)"
if [[ -z "$CURRENT" ]]; then
  "$LIMACTL_PATH" create --name "$INSTANCE" "$TEMPLATE"
  CREATED=1
elif [[ "$CURRENT" == Broken ]]; then
  echo "ERROR: existing Major Lima worker is broken; refusing to delete user state: $INSTANCE" >&2
  exit 1
fi
validate_instance

CURRENT="$(status)"
ORIGINAL_STATUS="$CURRENT"
if [[ "$CURRENT" != Running ]]; then
  "$LIMACTL_PATH" start "$INSTANCE"
fi

# A release-specific worker is immutable once provisioned. Same-SHA installs
# health-check and reuse it. Incomplete existing state is never repaired in
# place because it may be the active runtime.
if [[ $CREATED -eq 0 ]]; then
  if "$LIMACTL_PATH" shell --tty=false "$INSTANCE" test \
      -x /opt/major/providers/v1/claude/bin/claude \
      -a -x /opt/major/providers/v1/codex/bin/codex-native \
      -a -x /opt/major/providers/v1/codex/bin/codex-code-mode-host \
      -a -x /opt/major/providers/v1/cursor/bin/cursor-agent \
      -a -x /opt/major/providers/v1/antigravity/bin/agy \
      -a -r /opt/major/runner-version \
      -a -r "/opt/major/releases/$RELEASE_SHA" && \
    "$LIMACTL_PATH" shell --tty=false "$INSTANCE" command -v node >/dev/null && \
    "$LIMACTL_PATH" shell --tty=false "$INSTANCE" command -v npm >/dev/null; then
    if [[ "$ORIGINAL_STATUS" != Running ]]; then
      "$LIMACTL_PATH" stop "$INSTANCE"
    fi
    trap - EXIT
    echo "Major Lima worker already provisioned: $INSTANCE ($ORIGINAL_STATUS)"
    exit 0
  fi
  if [[ "$ORIGINAL_STATUS" != Running ]]; then
    "$LIMACTL_PATH" stop "$INSTANCE" >/dev/null 2>&1 || true
  fi
  echo "ERROR: existing Major Lima worker is incomplete; refusing in-place mutation: $INSTANCE" >&2
  exit 1
fi

stage="$(mktemp -d "${TMPDIR:-/tmp}/major-lima-provision.XXXXXX")"
cleanup() {
  local code=$?
  "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo rm -rf -- /tmp/major-bootstrap >/dev/null 2>&1 || true
  rm -rf "$stage"
  rollback "$code"
}
trap cleanup EXIT
mkdir -p "$stage/scripts" "$stage/templates/apparmor"
cp "$ROOT/scripts/bootstrap-major-lima-worker.sh" "$stage/scripts/"
cp "$ROOT/scripts/install-major-linux-providers.sh" "$stage/scripts/"
cp "$ROOT/scripts/configure-major-antigravity-run.py" "$stage/scripts/"
cp "$ROOT/scripts/manage-major-provider-state.py" "$stage/scripts/"
cp "$ROOT/templates/apparmor/major-cursor-sandbox" "$stage/templates/apparmor/"
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo rm -rf -- /tmp/major-bootstrap
"$LIMACTL_PATH" copy --backend=scp --recursive "$stage" "$INSTANCE:/tmp/major-bootstrap"
if "$LIMACTL_PATH" shell --tty=false "$INSTANCE" test -x /opt/major/providers/v1/claude/bin/claude \
  -a -x /opt/major/providers/v1/codex/bin/codex-native \
  -a -x /opt/major/providers/v1/codex/bin/codex-code-mode-host \
  -a -x /opt/major/providers/v1/cursor/bin/cursor-agent \
  -a -x /opt/major/providers/v1/antigravity/bin/agy; then
  "$LIMACTL_PATH" shell --tty=false "$INSTANCE" bash /tmp/major-bootstrap/scripts/bootstrap-major-lima-worker.sh
else
  "$LIMACTL_PATH" shell --tty=false "$INSTANCE" bash \
    /tmp/major-bootstrap/scripts/install-major-linux-providers.sh \
    /tmp/major-bootstrap/provider-source
  "$LIMACTL_PATH" shell --tty=false "$INSTANCE" env \
    MAJOR_PROVIDER_SOURCE=/tmp/major-bootstrap/provider-source \
    bash /tmp/major-bootstrap/scripts/bootstrap-major-lima-worker.sh
fi
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo rm -rf -- /tmp/major-bootstrap
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" test -r /opt/major/runner-version
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" command -v node >/dev/null
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" command -v npm >/dev/null
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo install -d -m 0755 /opt/major/releases
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo touch "/opt/major/releases/$RELEASE_SHA"
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo chmod 0444 "/opt/major/releases/$RELEASE_SHA"
migrate_existing_auth
"$LIMACTL_PATH" stop "$INSTANCE"

trap - EXIT
rm -rf "$stage"
echo "Major Lima worker provisioned and stopped: $INSTANCE"
