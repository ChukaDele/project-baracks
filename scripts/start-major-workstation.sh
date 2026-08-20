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
  if pid_alive "${dsh_pid:-}"; then
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
  if pid_alive "${chrome_pid:-}"; then
    kill -TERM "$chrome_pid" 2>/dev/null || true
  fi
  rm -rf "$LOCK_DIR"
  echo "stopped Major workstation under $DSH_HOME"
}

wait_for_listen() {
  local timeout="$1"
  [[ "$timeout" == "0" ]] && return 0
  python3 - "$LISTEN_HOST" "$PORT" "$timeout" <<'PY'
import socket, sys, time
host, port, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
deadline = time.time() + timeout
while time.time() < deadline:
    sock = socket.socket()
    sock.settimeout(0.25)
    try:
        sock.connect((host, port))
        sock.close()
        raise SystemExit(0)
    except OSError:
        time.sleep(0.1)
    finally:
        sock.close()
raise SystemExit("workstation did not listen on %s:%s" % (host, port))
PY
}

if [[ "$STOP" -eq 1 ]]; then
  stop_workstation
  exit 0
fi

[[ -n "$PROJECT" ]] || fail "--project is required (real project directory)"
[[ -d "$PROJECT" ]] || fail "project is not a directory: $PROJECT"
PROJECT="$(cd "$PROJECT" && pwd)"

if [[ -d "$LOCK_DIR" ]]; then
  existing="$(cat "$LOCK_DIR/dsh.pid" 2>/dev/null || true)"
  if pid_alive "${existing:-}"; then
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
  echo "chrome app-mode: --app=${CHROME_URL} --user-data-dir=$CHROME_PROFILE"
  echo "preserve PATH (major CLI unchanged)"
  echo "live Major execution remains on Lima + official CLI/ACP"
  echo "no Electron, Tauri, LaunchAgent, or login daemon"
  exit 0
fi

[[ -x "$DSH_BIN" ]] || fail "pinned dsh missing: $DSH_BIN (install the attested pin first)"
CHROME_BIN="$(resolve_chrome)"
[[ "$PATH" == "$ORIGINAL_PATH" ]] || fail "refusing to start after PATH mutation"

mkdir -p "$DSH_HOME/run" "$DSH_HOME/logs" "$CHROME_PROFILE"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "workstation already running under $DSH_HOME"
fi
printf '%s\n' "$PROJECT" > "$CURRENT_PROJECT_FILE"
printf '%s\n' "$$" > "$LOCK_DIR/launcher.pid"

cleanup() {
  local dsh_pid chrome_pid
  dsh_pid="$(cat "$LOCK_DIR/dsh.pid" 2>/dev/null || true)"
  chrome_pid="$(cat "$LOCK_DIR/chrome.pid" 2>/dev/null || true)"
  if pid_alive "${dsh_pid:-}"; then
    kill -TERM "$dsh_pid" 2>/dev/null || true
  fi
  if pid_alive "${chrome_pid:-}"; then
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

if ! wait_for_listen "$READY_TIMEOUT"; then
  fail "pinned DSH web process did not bind ${LISTEN_HOST}:${PORT}"
fi

"$CHROME_BIN" --user-data-dir="$CHROME_PROFILE" --app="$CHROME_URL" --no-first-run \
  >> "$LOG_FILE" 2>&1 &
CHROME_PID=$!
printf '%s\n' "$CHROME_PID" > "$LOCK_DIR/chrome.pid"
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOCK_DIR/ready"

echo "Major workstation listening on ${LISTEN_HOST}:${PORT}"
echo "Chrome app-mode: $CHROME_URL"
echo "project: $PROJECT"
echo "log: $LOG_FILE"
echo "live Major execution remains on Lima + official CLI/ACP"

wait "$DSH_PID" || true
