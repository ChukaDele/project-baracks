#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMACTL_PATH="${1:?usage: provision-major-lima-worker.sh <limactl-path> [instance]}"
INSTANCE="${2:-major-worker}"
TEMPLATE="$ROOT/templates/lima/major-worker.yaml"
CREATED=0

case "$INSTANCE" in
  major-worker) ;;
  *) echo "ERROR: unsupported Major Lima instance: $INSTANCE" >&2; exit 2 ;;
esac

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

rollback() {
  local code="${1:-$?}"
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

CURRENT="$(status)"
if [[ "$CURRENT" != Running ]]; then
  "$LIMACTL_PATH" start "$INSTANCE"
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
"$LIMACTL_PATH" stop "$INSTANCE"

trap - EXIT
rm -rf "$stage"
echo "Major Lima worker provisioned and stopped: $INSTANCE"
