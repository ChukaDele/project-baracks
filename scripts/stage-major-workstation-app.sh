#!/usr/bin/env bash
# Stage or remove the reversible Major.app launcher while keeping its runtime
# state inside an isolated DSH home.
# Does not install npm packages, change the live Major backend, or mutate PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
DSH_HOME="${MAJOR_DSH_HOME:-$MAJOR_HOME/dsh-harness}"
APP_SOURCE="$ROOT/distribution/deepseek-harness/macos/Major.app"
LAUNCHER_SOURCE="$ROOT/scripts/start-major-workstation.sh"
APP_DIR="${MAJOR_APP_DIR:-$HOME/Applications}"
APP_DEST="$APP_DIR/Major.app"
MARKER_REL="Contents/Resources/major-dsh-installer-owned"
POINTER_REL="Contents/Resources/major-dsh-home"
MARKER_VALUE="major-dsh-workstation-app-v1"
DRY_RUN=0
REMOVE=0

fail() { echo "MAJOR WORKSTATION APP FAILED: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
stage-major-workstation-app.sh — installer-managed Major.app with isolated DSH state

  --dry-run    Print planned copies without mutating APP_DIR or DSH_HOME
  --remove     Delete Major.app, the staged launcher, lock, and chrome profile
  --help       Show this help

Environment:
  MAJOR_HOME      Major state root (default: ~/.major)
  MAJOR_DSH_HOME  Isolated harness home (default: $MAJOR_HOME/dsh-harness)
  MAJOR_APP_DIR   Major.app parent directory (default: ~/Applications)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --remove) REMOVE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -d "$APP_SOURCE" ]] || fail "missing Major.app source: $APP_SOURCE"
[[ -f "$LAUNCHER_SOURCE" ]] || fail "missing launcher source: $LAUNCHER_SOURCE"

LAUNCHER_DEST="$DSH_HOME/bin/start-major-workstation.sh"

installer_owns_app() {
  [[ -d "$APP_DEST" && ! -L "$APP_DEST" ]] || return 1
  [[ -f "$APP_DEST/$MARKER_REL" ]] || return 1
  [[ "$(cat "$APP_DEST/$MARKER_REL")" == "$MARKER_VALUE" ]]
}

refuse_unowned_app() {
  if [[ -e "$APP_DEST" || -L "$APP_DEST" ]]; then
    installer_owns_app || fail "refusing to overwrite or remove unmarked app: $APP_DEST"
  fi
}

refuse_unowned_app

if [[ "$REMOVE" -eq 1 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] remove installer-owned app $APP_DEST"
    echo "[dry-run] remove reversible launcher state from $DSH_HOME"
    echo "[dry-run] preserve live Major path and DSH pin runtime"
    exit 0
  fi
  if [[ -e "$APP_DEST" ]]; then
    rm -rf "$APP_DEST"
  fi
  rm -rf "$DSH_HOME/bin/start-major-workstation.sh" \
    "$DSH_HOME/run/workstation.lock" "$DSH_HOME/chrome-profile"
  echo "removed installer-owned Major.app launcher from $APP_DEST"
  echo "normal trusted repository execution defaults to DSH local"
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] stage $APP_SOURCE -> $APP_DEST"
  echo "[dry-run] write installer marker and DSH-home pointer in $APP_DEST"
  echo "[dry-run] stage $LAUNCHER_SOURCE -> $LAUNCHER_DEST"
  echo "[dry-run] preserve live Major path (do not rewrite PATH)"
  exit 0
fi

mkdir -p "$DSH_HOME/bin" "$DSH_HOME/run" "$DSH_HOME/logs" "$APP_DIR"
DSH_HOME="$(cd "$DSH_HOME" && pwd)"
APP_STAGE="$APP_DIR/.Major.app.stage.$$"
APP_BACKUP="$APP_DIR/.Major.app.backup.$$"
[[ ! -e "$APP_STAGE" && ! -e "$APP_BACKUP" ]] || fail "temporary app path already exists"
cleanup_stage() {
  rm -rf "$APP_STAGE"
  if [[ -e "$APP_BACKUP" && ! -e "$APP_DEST" ]]; then
    mv "$APP_BACKUP" "$APP_DEST"
  fi
}
trap cleanup_stage EXIT INT TERM
cp -R "$APP_SOURCE" "$APP_STAGE"
mkdir -p "$APP_STAGE/Contents/Resources"
printf '%s\n' "$MARKER_VALUE" > "$APP_STAGE/$MARKER_REL"
printf '%s\n' "$DSH_HOME" > "$APP_STAGE/$POINTER_REL"
chmod +x "$APP_STAGE/Contents/MacOS/Major"
if [[ -e "$APP_DEST" ]]; then
  mv "$APP_DEST" "$APP_BACKUP"
fi
if ! mv "$APP_STAGE" "$APP_DEST"; then
  if [[ -e "$APP_BACKUP" ]]; then
    mv "$APP_BACKUP" "$APP_DEST"
  fi
  fail "could not activate staged app; previous installer-owned app restored"
fi
rm -rf "$APP_BACKUP"
trap - EXIT INT TERM
cp -f "$LAUNCHER_SOURCE" "$LAUNCHER_DEST"
chmod +x "$LAUNCHER_DEST"
echo "staged reversible Major.app launcher at $APP_DEST"
echo "normal trusted repository execution defaults to DSH local"
