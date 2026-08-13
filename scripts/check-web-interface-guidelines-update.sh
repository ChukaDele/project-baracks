#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md"
PINNED_COMMIT="4e799d45c17aec1498c269287a83b9dba22b966b"
PINNED_SHA256="eea73cb6dd46fee9faec9973e8e7fe198b5f07ec326f14d276a56e50287e1cab"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$SOURCE" -o "$TMP"

REMOTE_SHA256="$(shasum -a 256 "$TMP" | awk '{print $1}')"
echo "Pinned commit: $PINNED_COMMIT"
echo "Pinned SHA-256: $PINNED_SHA256"
echo "Remote SHA-256: $REMOTE_SHA256"

if [ "$REMOTE_SHA256" = "$PINNED_SHA256" ]; then
  echo "Vercel Web Interface Guidelines are unchanged."
else
  echo "Upstream changed. Review command.md against the pinned commit and update the adapted rules deliberately; this script never overwrites them." >&2
  exit 1
fi
