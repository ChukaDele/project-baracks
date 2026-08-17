#!/usr/bin/env bash
# Copy a tree with APFS clonefile (`cp -c`) when available, otherwise a normal
# copy. Never fail the caller because cloning was unavailable. After either
# path, the destination must be byte-identical to the source.
set -euo pipefail

major_clone_or_copy() {
  local src="${1:?source required}"
  local dest="${2:?destination required}"
  if [ ! -e "$src" ]; then
    echo "ERROR: clone source does not exist: $src" >&2
    return 2
  fi
  if [ -e "$dest" ]; then
    echo "ERROR: clone destination already exists: $dest" >&2
    return 2
  fi
  mkdir -p "$(dirname "$dest")"
  if cp -c -R "$src" "$dest" 2>/dev/null; then
    :
  else
    cp -R "$src" "$dest"
  fi
  if ! diff -rq "$src" "$dest" >/dev/null; then
    echo "ERROR: cloned tree is not byte-identical to source: $src -> $dest" >&2
    return 1
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  major_clone_or_copy "${1:?}" "${2:?}"
fi
