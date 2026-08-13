#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMACTL_PATH="${1:?usage: provision-major-lima-worker.sh <limactl-path> [instance]}"
INSTANCE="${2:-major-worker}"
RELEASE_SHA="${3:-legacy-v1}"
TEMPLATE="$ROOT/templates/lima/major-worker.yaml"
CREATED=0
LEGACY_SOURCE_STARTED=0

case "$INSTANCE" in
  major-worker|major-worker-[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) ;;
  *) echo "ERROR: unsupported Major Lima instance: $INSTANCE" >&2; exit 2 ;;
esac
if [[ "$INSTANCE" != major-worker && ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR: release-specific worker requires the full release SHA" >&2
  exit 2
fi

status() {
  "$LIMACTL_PATH" list --json | python3 -c '
import json, sys
name = sys.argv[1]
for line in sys.stdin:
    if not line.strip(): continue
    row = json.loads(line)
    if row.get("name") == name:
        print(row.get("status", ""))
        break
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
  local source_status provider relative
  source_status="$({ "$LIMACTL_PATH" list --json | python3 -c '
import json, sys
for line in sys.stdin:
    if not line.strip(): continue
    row = json.loads(line)
    if row.get("name") == "major-worker": print(row.get("status", "")); break
'; } || true)"
  [[ -z "$source_status" ]] && return 0
  if [[ "$source_status" == Broken ]]; then
    echo "ERROR: refusing credential migration from broken major-worker" >&2
    return 1
  fi
  if [[ "$source_status" != Running ]]; then
    "$LIMACTL_PATH" start major-worker
    LEGACY_SOURCE_STARTED=1
  fi
  # Stream only the three exact provider credentials authorised for migration.
  # Missing credentials remain a provider-specific post-install step. Opaque
  # bytes are never printed, interpreted, or written to host storage.
  for entry in \
    'codex:codex/.codex/auth.json' \
    'cursor:cursor/.config/cursor/auth.json' \
    'antigravity:antigravity/.gemini/antigravity-cli/antigravity-oauth-token'; do
    provider="${entry%%:*}"
    relative="${entry#*:}"
    if ! "$LIMACTL_PATH" shell --tty=false major-worker sudo test \
        -f "/var/lib/major/provider-auth/$relative" || \
      ! "$LIMACTL_PATH" shell --tty=false major-worker sudo test \
        ! -L "/var/lib/major/provider-auth/$relative"; then
      continue
    fi
    if ! "$LIMACTL_PATH" shell --tty=false major-worker sudo tar \
        -C /var/lib/major/provider-auth -cf - "$relative" 2>/dev/null | \
        "$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo tar \
          -C /var/lib/major/provider-auth -xf -; then
      restore_legacy_source
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
      restore_legacy_source
      echo "ERROR: migrated $provider credential failed destination validation" >&2
      return 1
    fi
  done
  restore_legacy_source
}

restore_legacy_source() {
  if [[ $LEGACY_SOURCE_STARTED -eq 1 ]]; then
    if ! "$LIMACTL_PATH" stop major-worker >/dev/null 2>&1; then
      echo "CRITICAL: failed to restore legacy major-worker to Stopped" >&2
      return 1
    fi
    LEGACY_SOURCE_STARTED=0
  fi
}

rollback() {
  local code="${1:-$?}"
  restore_legacy_source || true
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
      -a -x /opt/major/providers/v1/cursor/bin/cursor-agent \
      -a -x /opt/major/providers/v1/antigravity/bin/agy \
      -a -r /opt/major/runner-version \
      -a -r "/opt/major/releases/$RELEASE_SHA"; then
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
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo install -d -m 0755 /opt/major/releases
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo touch "/opt/major/releases/$RELEASE_SHA"
"$LIMACTL_PATH" shell --tty=false "$INSTANCE" sudo chmod 0444 "/opt/major/releases/$RELEASE_SHA"
migrate_existing_auth
"$LIMACTL_PATH" stop "$INSTANCE"

trap - EXIT
rm -rf "$stage"
echo "Major Lima worker provisioned and stopped: $INSTANCE"
