#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  echo "Major Lima bootstrap must run inside the Linux worker" >&2
  exit 1
fi

admin_home="${HOME:?HOME is required}"
install_root=/opt/major/providers/v1

existing_install=0
[[ -e "$install_root" ]] && existing_install=1

# The provider binary is not the project toolchain. Native DSH workers must be
# able to execute the same repository checks that they request on a trusted
# local environment. Keep the first baseline deliberately small and use the
# Ubuntu image's maintained packages instead of installing another runtime
# manager or a second provider image.
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs npm
fi

for provider in claude codex cursor antigravity; do
  user="major-${provider}"
  if ! id "$user" >/dev/null 2>&1; then
    sudo useradd --create-home --shell /usr/sbin/nologin "$user"
  fi
  sudo chmod 0700 "/home/${user}"
done

if [[ $existing_install -eq 0 && -n "${MAJOR_PROVIDER_SOURCE:-}" ]]; then
  source_root="$(readlink -f "$MAJOR_PROVIDER_SOURCE")"
  claude_real="$source_root/claude/bin/claude"
  codex_real="$source_root/codex/bin/codex-native"
  codex_code_mode_host_real="$source_root/codex/bin/codex-code-mode-host"
  bwrap_real="$source_root/codex/bin/bwrap"
  cursor_root="$source_root/cursor/bin"
  agy_real="$source_root/antigravity/bin/agy"
elif [[ $existing_install -eq 0 ]]; then
  claude_real="$(readlink -f "$admin_home/.local/bin/claude")"
  codex_entry="$(readlink -f "$admin_home/.local/bin/codex")"
  codex_scope="$(dirname "$(dirname "$(dirname "$codex_entry")")")"
  codex_real="$codex_scope/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex"
  codex_code_mode_host_real="$codex_scope/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex-code-mode-host"
  bwrap_real="$codex_scope/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/codex-resources/bwrap"
  cursor_real="$(readlink -f "$admin_home/.local/bin/cursor-agent")"
  cursor_root="$(dirname "$cursor_real")"
  agy_real="$(readlink -f "$admin_home/.local/bin/agy")"
fi

if [[ $existing_install -eq 0 ]]; then
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  install -d "$staging/claude/bin" "$staging/codex/bin" "$staging/cursor/bin" "$staging/antigravity/bin"
  cp "$claude_real" "$staging/claude/bin/claude"
  cp "$codex_real" "$staging/codex/bin/codex-native"
  cp "$codex_code_mode_host_real" "$staging/codex/bin/codex-code-mode-host"
  cp "$bwrap_real" "$staging/codex/bin/bwrap"
  cp -R "$cursor_root/." "$staging/cursor/bin/"
  cp "$agy_real" "$staging/antigravity/bin/agy"
  chmod -R a+rX "$staging"
else
  for executable in \
    "$install_root/claude/bin/claude" \
    "$install_root/codex/bin/codex-native" \
    "$install_root/codex/bin/codex-code-mode-host" \
    "$install_root/cursor/bin/cursor-agent" \
    "$install_root/antigravity/bin/agy"; do
    [[ -x "$executable" ]] || { echo "existing provider installation is incomplete: $executable" >&2; exit 1; }
  done
fi

sudo install -d -m 0755 /opt/major/providers
sudo install -d -m 0711 -o root -g root /var/lib/major/runs
sudo install -d -m 0700 -o root -g root /var/lib/major/provider-auth /var/lib/major/projects
sudo install -d -m 0700 -o "$(id -un)" -g "$(id -gn)" /var/lib/major/transfer
for provider in claude codex cursor antigravity; do
  sudo install -d -m 0710 -o root -g "major-${provider}" "/var/lib/major/runs/${provider}"
done
for provider in claude codex cursor antigravity; do
  user="major-${provider}"
  case "$provider" in
    claude) auth_relative=.claude/.credentials.json ;;
    codex) auth_relative=.codex/auth.json ;;
    cursor) auth_relative=.config/cursor/auth.json ;;
    antigravity) auth_relative=.gemini/antigravity-cli/antigravity-oauth-token ;;
  esac
  auth_source="/home/${user}/${auth_relative}"
  auth_target="/var/lib/major/provider-auth/${provider}/${auth_relative}"
  # The owner explicitly authorised opaque in-VM migration for these exact
  # credential files. Nothing else from a provider home enters this store.
  if ! sudo test -e "$auth_target" && \
    sudo test -f "$auth_source" && \
    sudo test ! -L "$auth_source"; then
    sudo install -d -m 0700 -o root -g root "$(dirname "$auth_target")"
    sudo install -m 0440 -o root -g "$user" "$auth_source" "$auth_target"
  fi
done
if [[ $existing_install -eq 0 ]]; then
  sudo cp -R "$staging" "$install_root"
fi
# Codex resolves the pinned provider directory first on PATH. Keep its pinned
# bubblewrap there rather than replacing the distribution-owned /usr/bin tool.
if [[ -f /etc/apparmor.d/bwrap-userns-restrict ]]; then
  sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cursor_apparmor_source="$(readlink -f "$script_dir/../templates/apparmor/major-cursor-sandbox")"
sudo install -m 0644 -o root -g root "$cursor_apparmor_source" /etc/apparmor.d/major-cursor-sandbox
sudo apparmor_parser -r /etc/apparmor.d/major-cursor-sandbox
sudo tee /opt/major/run-provider >/dev/null <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
workspace="${1:?workspace required}"
executable="${2:?executable required}"
shift 2
if [[ ! "$workspace" =~ ^/var/lib/major/runs/(claude|codex|cursor|antigravity)/[a-f0-9-]{36}/workspace$ ]]; then
  echo "invalid Major workspace" >&2
  exit 64
fi
case "${USER}:${executable}" in
  major-claude:/opt/major/providers/v1/claude/bin/claude | \
  major-codex:/opt/major/providers/v1/codex/bin/codex-native | \
  major-cursor:/opt/major/providers/v1/cursor/bin/cursor-agent | \
  major-antigravity:/opt/major/providers/v1/antigravity/bin/agy) ;;
  *) echo "provider identity mismatch" >&2; exit 64 ;;
esac
cd -- "$workspace"
exec "$executable" "$@"
RUNNER
sudo chmod 0555 /opt/major/run-provider
sudo install -m 0555 -o root -g root \
  "$script_dir/configure-major-antigravity-run.py" \
  /opt/major/configure-antigravity-run
sudo install -m 0555 -o root -g root \
  "$script_dir/manage-major-provider-state.py" \
  /opt/major/manage-provider-state
printf '%s\n' 'major-lima-worker-v1' | sudo tee /opt/major/runner-version >/dev/null
sudo chmod 0444 /opt/major/runner-version
command -v node >/dev/null
command -v npm >/dev/null

for provider in claude codex cursor antigravity; do
  user="major-${provider}"
  other="major-claude"
  [[ "$provider" == claude ]] && other=major-codex
  if sudo -u "$user" test -r "/home/${other}"; then
    echo "provider home isolation failed for $user" >&2
    exit 1
  fi
done

echo "Major Lima worker bootstrap complete; authenticate each provider as its dedicated user"
