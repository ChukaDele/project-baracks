#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
CHECKED=0

if [ -x "$BIN_DIR/claude" ]; then
  CLAUDE_HELP="$($BIN_DIR/claude --help 2>&1)"
  for flag in --output-format --permission-mode --safe-mode --no-session-persistence --no-chrome; do
    grep -Fq -- "$flag" <<<"$CLAUDE_HELP" || { echo "provider CLI contract failed: claude lacks $flag" >&2; exit 1; }
  done
  CHECKED=$((CHECKED + 1))
fi

if [ -x "$BIN_DIR/codex" ]; then
  CODEX_HELP="$($BIN_DIR/codex exec --help 2>&1)"
  for flag in --json --sandbox --ignore-user-config --ephemeral; do
    grep -Fq -- "$flag" <<<"$CODEX_HELP" || { echo "provider CLI contract failed: codex lacks $flag" >&2; exit 1; }
  done
  CHECKED=$((CHECKED + 1))
fi

if [ -x "$BIN_DIR/cursor-agent" ]; then
  CURSOR_HELP="$($BIN_DIR/cursor-agent --help 2>&1)"
  for flag in --output-format --sandbox --auto-review --resume; do
    grep -Fq -- "$flag" <<<"$CURSOR_HELP" || { echo "provider CLI contract failed: cursor-agent lacks $flag" >&2; exit 1; }
  done
  CHECKED=$((CHECKED + 1))
fi

if [ -x "$BIN_DIR/agy" ]; then
  AGY_HELP="$($BIN_DIR/agy --help 2>&1)"
  for flag in --output-format --sandbox --conversation --model; do
    grep -Fq -- "$flag" <<<"$AGY_HELP" || { echo "provider CLI contract failed: agy lacks $flag" >&2; exit 1; }
  done
  CHECKED=$((CHECKED + 1))
fi

if [ "$CHECKED" -eq 0 ]; then
  echo "Major provider CLI contract validation skipped: no canonical CLIs installed; provider field gate remains open."
else
  echo "Major provider CLI contract validation passed ($CHECKED canonical CLIs checked)."
fi
