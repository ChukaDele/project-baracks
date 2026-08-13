#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo "Major provider installation supports Linux arm64 only" >&2
  exit 1
fi

destination="${1:?usage: install-major-linux-providers.sh <destination>}"
case "$destination" in
  /|/opt|/usr|/var|/home) echo "refusing unsafe provider destination: $destination" >&2; exit 2 ;;
esac

for dependency in curl python3; do
  command -v "$dependency" >/dev/null || { echo "missing required dependency: $dependency" >&2; exit 1; }
done

claude_version=2.1.228
claude_url="https://downloads.claude.ai/claude-code-releases/${claude_version}/linux-arm64/claude"
claude_sha256=2664006219497bf7021ac43156519cd42eda64ceb2a66f434ecab83e7831f942
codex_version=0.147.0
codex_url="https://github.com/openai/codex/releases/download/rust-v${codex_version}/codex-aarch64-unknown-linux-musl.tar.gz"
codex_sha256=eb677c80f666b1ab8b4b1d083b66e8d614b1281d960bb6f9fd8ca98f58b38b90
bwrap_url="https://github.com/openai/codex/releases/download/rust-v${codex_version}/bwrap-aarch64-unknown-linux-musl.tar.gz"
bwrap_sha256=5b7fa3624a971cf5857b19bccfbcba2e653b7d09253020c37395245d70cb8bed
cursor_version=2026.08.11-e8db854
cursor_url="https://downloads.cursor.com/lab/${cursor_version}/linux/arm64/agent-cli-package.tar.gz"
cursor_sha256=ea13f92e295f523a99ce8d8f57d6894d21e5d1e2d030ffad718ccd5955ca2eed
antigravity_version=1.1.12
antigravity_url="https://storage.googleapis.com/antigravity-public/antigravity-cli/1.1.12-5877618327814144/linux-arm/cli_linux_arm64.tar.gz"
antigravity_sha512=fd33d449ddfc7917ab4f38968cda8356d3bca9f0b12eec9665e565af4ca44010cfb4b7a76de4e06adbef670b4863b30d75814e17dee855efcce651da22eecd95

lock_contents="claude ${claude_version} sha256:${claude_sha256}
codex ${codex_version} sha256:${codex_sha256}
cursor ${cursor_version} sha256:${cursor_sha256}
antigravity ${antigravity_version} sha512:${antigravity_sha512}"

if [[ -e "$destination" ]]; then
  [[ -f "$destination/.major-provider-lock" ]] || { echo "existing provider destination is unmanaged" >&2; exit 1; }
  [[ "$(cat "$destination/.major-provider-lock")" == "$lock_contents" ]] || {
    echo "existing provider destination does not match the pinned release" >&2
    exit 1
  }
  for executable in \
    "$destination/claude/bin/claude" \
    "$destination/codex/bin/codex-native" \
    "$destination/codex/bin/bwrap" \
    "$destination/cursor/bin/cursor-agent" \
    "$destination/antigravity/bin/agy"; do
    [[ -x "$executable" ]] || { echo "existing provider destination is incomplete: $executable" >&2; exit 1; }
  done
  echo "Pinned Major Linux providers already installed: $destination"
  exit 0
fi

parent="$(dirname "$destination")"
mkdir -p "$parent"
staging="$(mktemp -d "${parent}/.major-providers.XXXXXX")"
downloads="$(mktemp -d)"
cleanup() {
  local code=$?
  rm -rf "$downloads" "$staging"
  return "$code"
}
trap cleanup EXIT

download() {
  local url="$1" output="$2"
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 --output "$output" "$url"
}

verify_sha256() {
  local expected="$1" file="$2"
  printf '%s  %s\n' "$expected" "$file" | sha256sum --check --status
}

verify_sha512() {
  local expected="$1" file="$2"
  printf '%s  %s\n' "$expected" "$file" | sha512sum --check --status
}

extract_archive() {
  local archive="$1" target="$2"
  mkdir -p "$target"
  python3 - "$archive" "$target" <<'PY'
from pathlib import Path
import sys, tarfile

archive, target = Path(sys.argv[1]), Path(sys.argv[2])
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        path = Path(member.name)
        if path.is_absolute() or ".." in path.parts or member.isdev() or member.isfifo():
            raise SystemExit(f"unsafe archive member: {member.name}")
    bundle.extractall(target, filter="data")
PY
}

mkdir -p "$staging/claude/bin" "$staging/codex/bin" "$staging/cursor/bin" "$staging/antigravity/bin"

download "$claude_url" "$downloads/claude"
verify_sha256 "$claude_sha256" "$downloads/claude"
install -m 0555 "$downloads/claude" "$staging/claude/bin/claude"

download "$codex_url" "$downloads/codex.tar.gz"
verify_sha256 "$codex_sha256" "$downloads/codex.tar.gz"
extract_archive "$downloads/codex.tar.gz" "$downloads/codex"
install -m 0555 "$downloads/codex/codex-aarch64-unknown-linux-musl" "$staging/codex/bin/codex-native"

download "$bwrap_url" "$downloads/bwrap.tar.gz"
verify_sha256 "$bwrap_sha256" "$downloads/bwrap.tar.gz"
extract_archive "$downloads/bwrap.tar.gz" "$downloads/bwrap"
install -m 0555 "$downloads/bwrap/bwrap-aarch64-unknown-linux-musl" "$staging/codex/bin/bwrap"

download "$cursor_url" "$downloads/cursor.tar.gz"
verify_sha256 "$cursor_sha256" "$downloads/cursor.tar.gz"
extract_archive "$downloads/cursor.tar.gz" "$downloads/cursor"
cp -R "$downloads/cursor/dist-package/." "$staging/cursor/bin/"
chmod -R a+rX "$staging/cursor/bin"

download "$antigravity_url" "$downloads/antigravity.tar.gz"
verify_sha512 "$antigravity_sha512" "$downloads/antigravity.tar.gz"
extract_archive "$downloads/antigravity.tar.gz" "$downloads/antigravity"
install -m 0555 "$downloads/antigravity/antigravity" "$staging/antigravity/bin/agy"

printf '%s\n' "$lock_contents" > "$staging/.major-provider-lock"
chmod 0444 "$staging/.major-provider-lock"
mv "$staging" "$destination"
trap - EXIT
rm -rf "$downloads"
echo "Pinned Major Linux providers installed: $destination"
