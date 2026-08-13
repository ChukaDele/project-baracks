#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHA="${1:-}"
MAJOR_ROOT="${MAJOR_HOME:-$HOME/.major}"
SOCKET="$HOME/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh"
SYSTEM_ALLOWED_SIGNERS="/etc/major/staged-validation-allowed-signers"
SYSTEM_PUBLIC_KEY="/etc/major/staged-validation-authority.pub"
AUTHORITY_ROOT="$MAJOR_ROOT/staged-validation/authorities/$SHA"

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: issue-secure-enclave-staged-validation-lease.sh <exact-sha>" >&2
  exit 2
fi
if [ "$(git -C "$ROOT" rev-parse HEAD)" != "$SHA" ] || [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "ERROR: authority issuance requires the clean exact source SHA" >&2
  exit 1
fi
if ! git -C "$ROOT" fetch --quiet origin main; then
  echo "ERROR: authority issuance could not refresh origin/main" >&2
  exit 1
fi
REMOTE_MAIN_SHA="$(git -C "$ROOT" rev-parse FETCH_HEAD)"
if [ "$SHA" != "$REMOTE_MAIN_SHA" ]; then
  echo "ERROR: authority issuance requires the exact current origin/main SHA" >&2
  exit 1
fi
if [ ! -S "$SOCKET" ]; then
  echo "ERROR: Secretive SSH agent is unavailable" >&2
  exit 1
fi
if [ ! -f "$SYSTEM_ALLOWED_SIGNERS" ] || [ -L "$SYSTEM_ALLOWED_SIGNERS" ] || \
   [ ! -f "$SYSTEM_PUBLIC_KEY" ] || [ -L "$SYSTEM_PUBLIC_KEY" ]; then
  echo "ERROR: root-owned staged-validation trust anchor is unavailable" >&2
  exit 1
fi
ANCHOR_OWNER="$(stat -f '%Su:%Sg:%Lp' "$SYSTEM_ALLOWED_SIGNERS")"
PUBLIC_KEY_OWNER="$(stat -f '%Su:%Sg:%Lp' "$SYSTEM_PUBLIC_KEY")"
if [ "$ANCHOR_OWNER" != "root:wheel:444" ] || [ "$PUBLIC_KEY_OWNER" != "root:wheel:444" ]; then
  echo "ERROR: staged-validation trust anchor ownership or mode is unsafe" >&2
  exit 1
fi
EXPECTED_KEY="$(awk 'NR == 1 { print $2 " " $3 }' "$SYSTEM_ALLOWED_SIGNERS")"
PINNED_KEY="$(awk 'NR == 1 { print $1 " " $2 }' "$SYSTEM_PUBLIC_KEY")"
AGENT_KEY="$(SSH_AUTH_SOCK="$SOCKET" /usr/bin/ssh-add -L | awk 'NR == 1 { print $1 " " $2 }')"
if [ "$AGENT_KEY" != "$EXPECTED_KEY" ] || [ "$AGENT_KEY" != "$PINNED_KEY" ]; then
  echo "ERROR: Secretive agent key does not match the pinned staged-validation authority" >&2
  exit 1
fi
if [ -e "$AUTHORITY_ROOT" ]; then
  echo "ERROR: staged-validation authority already exists for $SHA" >&2
  exit 1
fi

PARENT="$(dirname "$AUTHORITY_ROOT")"
mkdir -p "$PARENT"
chmod 700 "$PARENT"
STAGE="$(mktemp -d "$PARENT/.${SHA}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
LEASE="$STAGE/major-staged-validation-lease.json"
node "$ROOT/scripts/create-secure-enclave-staged-validation-lease.mjs" "$LEASE" "$SHA"
SSH_AUTH_SOCK="$SOCKET" /usr/bin/ssh-keygen -Y sign \
  -f "$SYSTEM_PUBLIC_KEY" -n major-staged-validation "$LEASE"
node "$ROOT/scripts/verify-secure-enclave-staged-validation-lease.mjs" \
  "$LEASE" "$LEASE.sig" "$SHA" provider-field codex >/dev/null
chmod 600 "$LEASE" "$LEASE.sig"
mv "$STAGE" "$AUTHORITY_ROOT"
trap - EXIT
echo "Secure Enclave staged-validation authority issued for $SHA"
