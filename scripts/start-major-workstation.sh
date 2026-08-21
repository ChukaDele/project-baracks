#!/usr/bin/env bash
# Start or stop one loopback-only pinned DSH web process and a Chrome app-mode
# window for a real project. Installer-managed; not a daemon or Electron app.
set -euo pipefail

MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
DSH_HOME="${MAJOR_DSH_HOME:-${DSH_HOME:-$MAJOR_HOME/dsh-harness}}"
PROFILE="major-workstation-web"
LISTEN_HOST="127.0.0.1"
CHROME_HOST="localhost"
PORT="3080"
LOCK_DIR="$DSH_HOME/run/workstation.lock"
LOG_FILE="$DSH_HOME/logs/workstation.log"
CHROME_PROFILE="$DSH_HOME/chrome-profile"
CURRENT_PROJECT_FILE="$DSH_HOME/run/current-project"
DSH_BIN="${MAJOR_DSH_BIN:-$DSH_HOME/runtime/node_modules/.bin/dsh}"
MAJOR_BIN="$DSH_HOME/native-major/bin/major"
MAJOR_CONTROL_PLANE_MARKER="$DSH_HOME/native-major/major-control-plane.json"
CHROME_BIN="${MAJOR_CHROME_BIN:-}"
READY_TIMEOUT="${MAJOR_WORKSTATION_READY_TIMEOUT:-30}"
DRY_RUN=0
STOP=0
PROJECT=""
ORIGINAL_PATH="${PATH-}"

fail() { echo "MAJOR WORKSTATION FAILED: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
start-major-workstation.sh — one loopback DSH web process + Chrome app-mode window

  --project PATH   Real project directory (default workspace for DSH)
  --dry-run        Print planned actions without starting processes
  --stop           Stop the running workstation for this DSH home
  --help           Show this help

Environment:
  MAJOR_HOME / MAJOR_DSH_HOME / DSH_HOME
  MAJOR_DSH_BIN    Override pinned dsh executable
  MAJOR_CHROME_BIN Override Chrome/Chromium binary
  MAJOR_BIN        Set internally to the co-versioned Major control plane
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --stop) STOP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

export DSH_HOME
export MAJOR_BIN
export PATH="$ORIGINAL_PATH"

resolve_chrome() {
  if [[ -n "$CHROME_BIN" ]]; then
    [[ -x "$CHROME_BIN" ]] || fail "MAJOR_CHROME_BIN is not executable: $CHROME_BIN"
    printf '%s\n' "$CHROME_BIN"
    return 0
  fi
  local candidate
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  fail "Google Chrome not found; set MAJOR_CHROME_BIN"
}

pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

process_identity() {
  local pid="$1"
  pid_alive "$pid" || return 1
  # lstart is available on macOS and Linux and prevents a recycled PID from
  # inheriting authority from an old workstation lock.
  ps -p "$pid" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

pid_matches_lock() {
  local name="$1" pid expected actual
  pid="$(cat "$LOCK_DIR/$name.pid" 2>/dev/null || true)"
  expected="$(cat "$LOCK_DIR/$name.identity" 2>/dev/null || true)"
  [[ -n "$expected" ]] || return 1
  actual="$(process_identity "$pid" 2>/dev/null || true)"
  [[ -n "$actual" && "$actual" == "$expected" ]]
}

listener_pids() {
  command -v lsof >/dev/null 2>&1 || fail "lsof is required to verify port ownership"
  lsof -nP -a -iTCP@"$LISTEN_HOST":"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

assert_port_unowned() {
  local owners
  owners="$(listener_pids)"
  [[ -z "$owners" ]] || fail "refusing foreign listener on ${LISTEN_HOST}:${PORT} (pid(s): ${owners//$'\n'/,})"
}

stop_workstation() {
  if [[ ! -d "$LOCK_DIR" ]]; then
    echo "workstation not running under $DSH_HOME"
    return 0
  fi
  local dsh_pid chrome_pid
  dsh_pid="$(cat "$LOCK_DIR/dsh.pid" 2>/dev/null || true)"
  chrome_pid="$(cat "$LOCK_DIR/chrome.pid" 2>/dev/null || true)"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stop dsh pid ${dsh_pid:-none} and chrome pid ${chrome_pid:-none}"
    echo "[dry-run] remove $LOCK_DIR"
    return 0
  fi
  if pid_matches_lock dsh; then
    kill -TERM "$dsh_pid" 2>/dev/null || true
    local waited=0
    while pid_alive "$dsh_pid" && [[ "$waited" -lt 6 ]]; do
      sleep 1
      waited=$((waited + 1))
    done
    if pid_alive "$dsh_pid"; then
      kill -KILL "$dsh_pid" 2>/dev/null || true
    fi
  fi
  if pid_matches_lock chrome; then
    kill -TERM "$chrome_pid" 2>/dev/null || true
  fi
  rm -rf "$LOCK_DIR"
  echo "stopped Major workstation under $DSH_HOME"
}

wait_for_owned_listen() {
  local timeout="$1"
  local deadline owners
  deadline=$((SECONDS + timeout))
  while (( SECONDS <= deadline )); do
    pid_alive "$DSH_PID" || return 1
    owners="$(listener_pids)"
    if [[ -n "$owners" ]]; then
      if [[ "$owners" == "$DSH_PID" ]]; then
        return 0
      fi
      echo "foreign listener claimed ${LISTEN_HOST}:${PORT} (pid(s): ${owners//$'\n'/,})" >&2
      return 1
    fi
    sleep 0.1
  done
  return 1
}

verify_served_boot_graph() {
  command -v curl >/dev/null 2>&1 || fail "curl is required to verify the served DSH boot graph"
  local deadline body
  deadline=$((SECONDS + READY_TIMEOUT))
  while (( SECONDS <= deadline )); do
    pid_alive "$DSH_PID" || return 1
    body="$(curl --silent --show-error --fail --max-time 2 "$CHROME_URL" 2>/dev/null || true)"
    if [[ "$body" == *"__DSH_BOOT__"* ]]; then
      [[ "$body" == *"@major/dsh-kernel"* ]] || {
        echo "served __DSH_BOOT__ graph omits @major/dsh-kernel" >&2
        return 1
      }
      return 0
    fi
    sleep 0.1
  done
  echo "served page did not expose __DSH_BOOT__" >&2
  return 1
}

if [[ "$STOP" -eq 1 ]]; then
  stop_workstation
  exit 0
fi

[[ -n "$PROJECT" ]] || fail "--project is required (real project directory)"
[[ -d "$PROJECT" ]] || fail "project is not a directory: $PROJECT"
[[ "$READY_TIMEOUT" =~ ^[0-9]+$ ]] || fail "MAJOR_WORKSTATION_READY_TIMEOUT must be a non-negative integer"
PROJECT="$(cd "$PROJECT" && pwd)"

if [[ -d "$LOCK_DIR" ]]; then
  existing="$(cat "$LOCK_DIR/dsh.pid" 2>/dev/null || true)"
  if pid_matches_lock launcher || pid_matches_lock dsh; then
    fail "workstation already running (pid $existing) under $DSH_HOME"
  fi
  rm -rf "$LOCK_DIR"
fi

DSH_CMD=("$DSH_BIN" --profile "$PROFILE" --host "$LISTEN_HOST" --port "$PORT" --no-open --trusted-host "$CHROME_HOST")
CHROME_URL="http://${CHROME_HOST}:${PORT}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "mode: dry-run"
  echo "dsh home: $DSH_HOME"
  echo "profile: $PROFILE"
  echo "listen: ${LISTEN_HOST}:${PORT} (loopback only)"
  echo "project: $PROJECT"
  echo "log: $LOG_FILE"
  echo "lock: $LOCK_DIR"
  echo "dsh: ${DSH_CMD[*]}"
  echo "major control plane: $MAJOR_BIN"
  echo "chrome app-mode: --app=${CHROME_URL} --user-data-dir=$CHROME_PROFILE"
  echo "preserve PATH (major CLI unchanged)"
  echo "normal trusted repository execution defaults to DSH local"
  echo "DSH Lima and legacy Major/Lima remain explicit compatibility choices"
  echo "no Electron, Tauri, LaunchAgent, or login daemon"
  exit 0
fi

[[ -x "$DSH_BIN" ]] || fail "pinned dsh missing: $DSH_BIN (install the attested pin first)"
[[ -x "$MAJOR_BIN" ]] || fail "co-versioned Major control plane missing: $MAJOR_BIN (install the attested pin first)"
[[ -f "$MAJOR_CONTROL_PLANE_MARKER" ]] || \
  fail "co-versioned Major control-plane marker missing: $MAJOR_CONTROL_PLANE_MARKER"
CHROME_BIN="$(resolve_chrome)"
[[ "$PATH" == "$ORIGINAL_PATH" ]] || fail "refusing to start after PATH mutation"
assert_port_unowned

mkdir -p "$DSH_HOME/run" "$DSH_HOME/logs" "$CHROME_PROFILE"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "workstation already running under $DSH_HOME"
fi
printf '%s\n' "$PROJECT" > "$CURRENT_PROJECT_FILE"
printf '%s\n' "$$" > "$LOCK_DIR/launcher.pid"
process_identity "$$" > "$LOCK_DIR/launcher.identity"

cleanup() {
  local dsh_pid chrome_pid
  dsh_pid="$(cat "$LOCK_DIR/dsh.pid" 2>/dev/null || true)"
  chrome_pid="$(cat "$LOCK_DIR/chrome.pid" 2>/dev/null || true)"
  if pid_matches_lock dsh; then
    kill -TERM "$dsh_pid" 2>/dev/null || true
  fi
  if pid_matches_lock chrome; then
    kill -TERM "$chrome_pid" 2>/dev/null || true
  fi
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

{
  echo "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) start project=$PROJECT listen=${LISTEN_HOST}:${PORT}"
} >> "$LOG_FILE"

(
  cd "$PROJECT"
  exec "$DSH_BIN" --profile "$PROFILE" --host "$LISTEN_HOST" --port "$PORT" --no-open --trusted-host "$CHROME_HOST"
) >> "$LOG_FILE" 2>&1 &
DSH_PID=$!
printf '%s\n' "$DSH_PID" > "$LOCK_DIR/dsh.pid"
process_identity "$DSH_PID" > "$LOCK_DIR/dsh.identity"

if ! wait_for_owned_listen "$READY_TIMEOUT"; then
  fail "pinned DSH web process did not own ${LISTEN_HOST}:${PORT}"
fi
if ! verify_served_boot_graph; then
  fail "pinned DSH web boot graph verification failed"
fi

"$CHROME_BIN" --user-data-dir="$CHROME_PROFILE" --app="$CHROME_URL" --no-first-run \
  >> "$LOG_FILE" 2>&1 &
CHROME_PID=$!
printf '%s\n' "$CHROME_PID" > "$LOCK_DIR/chrome.pid"
CHROME_IDENTITY="$(process_identity "$CHROME_PID" 2>/dev/null || true)"
if [[ -n "$CHROME_IDENTITY" ]]; then
  printf '%s\n' "$CHROME_IDENTITY" > "$LOCK_DIR/chrome.identity"
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOCK_DIR/ready"
printf '%s\n' '@major/dsh-kernel' > "$LOCK_DIR/boot-graph"

echo "Major workstation listening on ${LISTEN_HOST}:${PORT}"
echo "served boot graph includes @major/dsh-kernel"
echo "Chrome app-mode: $CHROME_URL"
echo "project: $PROJECT"
echo "major control plane: $MAJOR_BIN"
echo "log: $LOG_FILE"
echo "normal trusted repository execution defaults to DSH local"
echo "DSH Lima and legacy Major/Lima remain explicit compatibility choices"

wait "$DSH_PID" || true
