#!/usr/bin/env bash
set -euo pipefail

SOCKET="$HOME/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh"
SYSTEM_ROOT="/etc/major"
SYSTEM_PUBLIC_KEY="$SYSTEM_ROOT/staged-validation-authority.pub"
SYSTEM_ALLOWED_SIGNERS="$SYSTEM_ROOT/staged-validation-allowed-signers"

if [ ! -S "$SOCKET" ]; then
  echo "ERROR: Secretive SSH agent is unavailable" >&2
  exit 1
fi
AGENT_KEY="$(SSH_AUTH_SOCK="$SOCKET" /usr/bin/ssh-add -L | awk 'NR == 1 { print $1 " " $2 }')"
if [[ ! "$AGENT_KEY" =~ ^ecdsa-sha2-nistp256\  ]]; then
  echo "ERROR: Secretive did not expose the expected Secure Enclave ECDSA key" >&2
  exit 1
fi

PUBLIC_LINE="$AGENT_KEY Major-v0.5.1-staged-validation@secretive"
SIGNERS_LINE="major-staged-validation $AGENT_KEY"

if [ -e "$SYSTEM_PUBLIC_KEY" ] || [ -e "$SYSTEM_ALLOWED_SIGNERS" ]; then
  [ -f "$SYSTEM_PUBLIC_KEY" ] && [ ! -L "$SYSTEM_PUBLIC_KEY" ] && \
    [ -f "$SYSTEM_ALLOWED_SIGNERS" ] && [ ! -L "$SYSTEM_ALLOWED_SIGNERS" ] && \
    [ "$(cat "$SYSTEM_PUBLIC_KEY")" = "$PUBLIC_LINE" ] && \
    [ "$(cat "$SYSTEM_ALLOWED_SIGNERS")" = "$SIGNERS_LINE" ] || {
      echo "ERROR: refusing to replace the existing staged-validation trust anchor" >&2
      exit 1
    }
  echo "Secure Enclave staged-validation trust anchor already installed"
  exit 0
fi

/usr/bin/osascript \
  -e 'on run argv' \
  -e 'set publicLine to quoted form of item 1 of argv' \
  -e 'set signersLine to quoted form of item 2 of argv' \
  -e 'set commandText to "set -e; /usr/bin/install -d -o root -g wheel -m 755 /etc/major; test ! -e /etc/major/staged-validation-authority.pub; test ! -e /etc/major/staged-validation-allowed-signers; /usr/bin/printf \"%s\\n\" " & publicLine & " > /etc/major/.staged-validation-authority.pub.new; /usr/bin/printf \"%s\\n\" " & signersLine & " > /etc/major/.staged-validation-allowed-signers.new; /usr/sbin/chown root:wheel /etc/major/.staged-validation-authority.pub.new /etc/major/.staged-validation-allowed-signers.new; /bin/chmod 444 /etc/major/.staged-validation-authority.pub.new /etc/major/.staged-validation-allowed-signers.new; /bin/mv /etc/major/.staged-validation-authority.pub.new /etc/major/staged-validation-authority.pub; /bin/mv /etc/major/.staged-validation-allowed-signers.new /etc/major/staged-validation-allowed-signers"' \
  -e 'do shell script commandText with administrator privileges' \
  -e 'end run' \
  "$PUBLIC_LINE" "$SIGNERS_LINE"
test "$(stat -f '%Su:%Sg:%Lp' "$SYSTEM_PUBLIC_KEY")" = 'root:wheel:444'
test "$(stat -f '%Su:%Sg:%Lp' "$SYSTEM_ALLOWED_SIGNERS")" = 'root:wheel:444'
[ "$(cat "$SYSTEM_PUBLIC_KEY")" = "$PUBLIC_LINE" ]
[ "$(cat "$SYSTEM_ALLOWED_SIGNERS")" = "$SIGNERS_LINE" ]
echo "Secure Enclave staged-validation trust anchor installed"
