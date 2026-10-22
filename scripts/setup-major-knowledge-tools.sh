#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-check}"
MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"

case "$MODE" in
  check|install) ;;
  *) echo "Usage: $0 [check|install]" >&2; exit 2 ;;
esac

status=0

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf 'OK   %-12s %s\n' "$name" "$(command -v "$name")"
    return 0
  fi
  printf 'MISS %-12s\n' "$name"
  status=1
  return 1
}

echo "Major knowledge tools"
echo "---------------------"

MW_OK=0
if check_command mw; then
  MW_OK=1
  mw version 2>/dev/null | head -n 1 || true
  mw models list 2>/dev/null | sed -n '1,5p' || true
else
  echo "MacWhisper CLI must be enabled in MacWhisper > Settings > Advanced > Command-Line Tool."
fi

YTDLP_OK=0
if check_command yt-dlp; then
  YTDLP_OK=1
  echo "yt-dlp $(yt-dlp --version 2>/dev/null || true)"
fi

if [ "$MODE" = "install" ] && [ "$YTDLP_OK" -eq 0 ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing yt-dlp with Homebrew..."
    brew install yt-dlp
    YTDLP_OK=1
    status=0
  else
    echo "ERROR: yt-dlp is missing and Homebrew is not available." >&2
    echo "Install yt-dlp using an official installation method, then rerun this script." >&2
    exit 3
  fi
fi

if command -v ffmpeg >/dev/null 2>&1; then
  printf 'OK   %-12s %s\n' "ffmpeg" "$(command -v ffmpeg)"
else
  printf 'INFO %-12s %s\n' "ffmpeg" "not installed; not required for the basic MacWhisper fallback, but useful for media conversions"
fi

if [ "$MW_OK" -eq 0 ]; then
  exit 4
fi
if [ "$MODE" = "check" ] && [ "$YTDLP_OK" -eq 0 ]; then
  echo "Next: run '$0 install' to add yt-dlp."
  exit 1
fi

echo "Major knowledge-tool check complete."
