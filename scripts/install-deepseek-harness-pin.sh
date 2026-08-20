#!/usr/bin/env bash
# Install the attested DeepSeek Harness pin into an isolated DSH_HOME.
# Normal trusted repository work runs through native DSH providers on the Mac.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
DSH_HOME="${MAJOR_DSH_HOME:-$MAJOR_HOME/dsh-harness}"
PIN_FILE="$ROOT/distribution/deepseek-harness/pin.json"
INSTALL_RECORD="$DSH_HOME/major-install.json"
RUNTIME_DIR="$DSH_HOME/runtime"
CODEX_PROFILE_HOME="${MAJOR_DSH_CODEX_PROFILE_HOME:-$HOME/.codex}"
DSH_CODEX_HOME="$DSH_HOME/providers/codex/default"
CODEX_ACCOUNT_POLICY="${MAJOR_CODEX_ACCOUNT_POLICY:-$MAJOR_HOME/codex-account-policy.json}"
KERNEL_SOURCE="$ROOT/distribution/deepseek-harness/bundles/major-kernel"
KERNEL_DEST="$DSH_HOME/bundles/major-kernel"
DRY_RUN=0

usage() {
  cat <<'EOF'
install-deepseek-harness-pin.sh — install attested DeepSeek Harness profiles

  --dry-run    Print the planned actions without mutating DSH_HOME
  --help       Show this help

Also stages a reversible Major.app launcher (loopback DSH web + Chrome app-mode).

Environment:
  MAJOR_HOME      Major state root (default: ~/.major)
  MAJOR_DSH_HOME  Isolated harness home (default: $MAJOR_HOME/dsh-harness)
  MAJOR_DSH_CODEX_PROFILE_HOME  Existing authenticated Codex profile (default: ~/.codex)
  MAJOR_CODEX_ACCOUNT_POLICY  Owner-approved named Codex profiles (default: ~/.major/codex-account-policy.json)
  MAJOR_APP_DIR   Major.app parent directory (default: ~/Applications)
EOF
}

fail() { echo "DSH PIN INSTALL FAILED: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -f "$PIN_FILE" ]] || fail "missing pin artifact: $PIN_FILE"

read_pin_header() {
  python3 - "$PIN_FILE" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
commit = pin.get("git", {}).get("attestedCommit")
if not commit or len(commit) != 40:
    raise SystemExit("attestedCommit is required before install")
version = pin["npm"]["version"]
for token in pin["npm"].get("forbiddenResolutions", []):
    if token in version:
        raise SystemExit(f"forbidden resolution token in pin version: {token}")
packages = pin["npm"]["packages"]
integrities = pin["npm"]["integrities"]
runtime_peers = pin["npm"]["runtimePeers"]
all_packages = {**packages, **runtime_peers["packages"]}
all_integrities = {**integrities, **runtime_peers["integrities"]}
for name, pkg_version in all_packages.items():
    if name in packages and pkg_version != version:
        raise SystemExit(f"{name} must match distribution pin {version}")
    if not all_integrities.get(name, "").startswith("sha512-"):
        raise SystemExit(f"missing npm integrity for {name}")
for name, pkg_version in packages.items():
    if pkg_version != version:
        raise SystemExit(f"{name} must match distribution pin {version}")
print(f"{version}\t{commit}")
PY
}

read_pin_packages() {
  python3 - "$PIN_FILE" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
packages = pin["npm"]["packages"]
integrities = pin["npm"]["integrities"]
runtime_peers = pin["npm"]["runtimePeers"]
all_packages = {**packages, **runtime_peers["packages"]}
all_integrities = {**integrities, **runtime_peers["integrities"]}
for name in sorted(all_packages):
    print(f"{name}\t{all_packages[name]}\t{all_integrities[name]}")
PY
}

IFS=$'\t' read -r PIN_VERSION PIN_COMMIT < <(read_pin_header)

# Match src/resources/preflight.ts: refuse install when Lima/npm cycling would fill the volume.
require_disk_headroom() {
  python3 - "${DSH_HOME}" <<'PY'
import os, sys
path = sys.argv[1]
while path and not os.path.exists(path):
    parent = os.path.dirname(path)
    if parent == path:
        break
    path = parent
if not path or not os.path.exists(path):
    path = os.getcwd()
st = os.statvfs(path)
free = st.f_bavail * st.f_frsize
total = st.f_blocks * st.f_frsize
percent_free = 0 if total == 0 else (100.0 * free / total)
need_bytes = 20 * 1024 * 1024 * 1024
need_percent = 10
if percent_free < need_percent or free < need_bytes:
    raise SystemExit(
        f"disk preflight blocked: {percent_free:.1f}% free ({free} bytes); "
        f"need at least {need_percent}% free and {need_bytes} bytes before DSH/Lima install"
    )
print(f"{percent_free:.1f}\t{free}")
PY
}

disk_preflight() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] disk preflight before DSH/Lima install"
    return 0
  fi
  local stats
  stats="$(require_disk_headroom)"
  echo "disk preflight ok: ${stats%%$'\t'*}% free"
}

verify_npm_integrity() {
  local name="$1" version="$2" expected="$3"
  local observed=""
  if ! observed="$(npm view "${name}@${version}" dist.integrity 2>/dev/null)"; then
    fail "npm registry lookup failed for ${name}@${version}"
  fi
  if [[ "$observed" != "$expected" ]]; then
    fail "integrity mismatch for ${name}@${version}: expected ${expected}, observed ${observed}"
  fi
}

stage_profile() {
  local profile_id="$1"
  local src="$ROOT/distribution/deepseek-harness/profiles/$profile_id"
  local dest="$DSH_HOME/profiles/$profile_id"
  [[ -d "$src" ]] || fail "missing profile source: $src"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage $src -> $dest"
    return 0
  fi
  mkdir -p "$dest"
  cp -f "$src/package.json" "$dest/package.json"
  cp -f "$src/cordis.patch.yml" "$dest/cordis.patch.yml"
  cp -f "$src/pnpm-workspace.yaml" "$dest/pnpm-workspace.yaml"
}

stage_kernel_bundle() {
  [[ -d "$KERNEL_SOURCE" ]] || fail "missing kernel bundle source: $KERNEL_SOURCE"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage $KERNEL_SOURCE -> $KERNEL_DEST"
    return 0
  fi
  mkdir -p "$KERNEL_DEST"
  cp -f "$KERNEL_SOURCE/package.json" "$KERNEL_DEST/package.json"
  cp -f "$KERNEL_SOURCE/index.js" "$KERNEL_DEST/index.js"
  cp -f "$KERNEL_SOURCE/client.js" "$KERNEL_DEST/client.js"
  cp -f "$KERNEL_SOURCE/lima-subprocess.js" "$KERNEL_DEST/lima-subprocess.js"
  # Remove the superseded raw-ESM split module on upgrade. The browser entry
  # is one self-contained lazy-CJS factory, as required by DSH client-modules.
  rm -f "$KERNEL_DEST/command-input.js"
  cp -f "$KERNEL_SOURCE/cordis.patch.yml" "$KERNEL_DEST/cordis.patch.yml"
}

link_kernel_runtime() {
  local destination="$KERNEL_DEST/node_modules"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] link shared runtime dependencies into $destination"
    return 0
  fi
  if [[ -L "$destination" ]]; then
    [[ "$(readlink "$destination")" == "$RUNTIME_DIR/node_modules" ]] || \
      fail "refusing to replace a kernel dependency link with a different target: $destination"
  elif [[ -e "$destination" ]]; then
    fail "refusing to replace existing kernel dependency directory: $destination"
  else
    ln -s "$RUNTIME_DIR/node_modules" "$destination"
  fi
}

stage_codex_worker_home() {
  local source_auth="$CODEX_PROFILE_HOME/auth.json"
  local dest_auth="$DSH_CODEX_HOME/auth.json"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage isolated Codex worker home $DSH_CODEX_HOME from existing auth $source_auth"
    return 0
  fi
  [[ -f "$source_auth" ]] || fail "authenticated Codex profile missing: $source_auth"
  mkdir -p "$DSH_CODEX_HOME"
  chmod 700 "$DSH_CODEX_HOME"
  if [[ -L "$dest_auth" ]]; then
    [[ "$(readlink "$dest_auth")" == "$source_auth" ]] || \
      fail "refusing to replace a Codex auth symlink with a different target: $dest_auth"
  elif [[ -e "$dest_auth" ]]; then
    fail "refusing to replace existing Codex worker auth: $dest_auth"
  else
    ln -s "$source_auth" "$dest_auth"
  fi
}

stage_named_codex_worker_homes() {
  if [[ ! -f "$CODEX_ACCOUNT_POLICY" ]]; then
    echo "No owner-approved named Codex profile policy; default Codex profile only."
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage owner-approved named Codex homes and official DSH adapters from $CODEX_ACCOUNT_POLICY"
    return 0
  fi
  python3 - "$CODEX_ACCOUNT_POLICY" "$DSH_HOME/providers/codex" "$KERNEL_DEST/cordis.patch.yml" <<'PY'
import json, os, re, sys
from pathlib import Path

policy_path, providers_root, patch_path = map(Path, sys.argv[1:4])
policy = json.loads(policy_path.read_text(encoding="utf-8"))
rows = policy.get("accounts")
if not isinstance(rows, list):
    raise SystemExit("invalid Codex account policy: accounts must be an array")

def label(policy_id):
    value = re.sub(r"[^a-z0-9]+", "-", policy_id.strip().lower()).strip("-")
    if not value or not value[0].isalpha():
        value = f"p-{value or 'profile'}".strip("-")
    value = value[:32].rstrip("-")
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", value) or value == "accounts":
        raise SystemExit(f"invalid normalized Codex account label for {policy_id}")
    return value

active = []
seen = set()
for row in rows:
    if not isinstance(row, dict) or row.get("role") != "active":
        continue
    policy_id, home = row.get("id"), row.get("home")
    if not isinstance(policy_id, str) or not re.fullmatch(r"COD-\d{2}", policy_id):
        raise SystemExit("invalid active Codex policy id")
    if not isinstance(home, str):
        raise SystemExit(f"missing home for {policy_id}")
    account_label = label(policy_id)
    if account_label in seen:
        raise SystemExit(f"duplicate normalized Codex account label: {account_label}")
    seen.add(account_label)
    source_auth = Path(home).expanduser().resolve() / "auth.json"
    if not source_auth.is_file():
        raise SystemExit(f"approved Codex profile credential is unavailable: {policy_id}")
    active.append((account_label, source_auth))

patch = []
for account_label, source_auth in active:
    worker_home = providers_root / account_label
    worker_home.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(worker_home, 0o700)
    dest_auth = worker_home / "auth.json"
    if dest_auth.is_symlink():
        if dest_auth.resolve() != source_auth:
            raise SystemExit(f"refusing to replace named Codex auth symlink: {account_label}")
    elif dest_auth.exists():
        raise SystemExit(f"refusing to replace named Codex worker auth: {account_label}")
    else:
        dest_auth.symlink_to(source_auth)
    patch.extend([
        "- insert:",
        f"    - id: subagent-codex-account-{account_label}",
        "      name: '@deepseek-ai/dsh-subagent-codex'",
        "      config:",
        f"        providerName: codex-{account_label}",
        "        permissionMode: approve-for-me",
        "        env:",
        f"          CODEX_HOME: !!js dshHomePath('providers/codex/{account_label}')",
    ])

if patch:
    with patch_path.open("a", encoding="utf-8") as handle:
        handle.write("\n" + "\n".join(patch) + "\n")
print(f"Staged {len(active)} owner-approved named Codex DSH adapter(s).")
PY
}

write_runtime_manifest() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] write exact runtime manifest in $RUNTIME_DIR"
    return 0
  fi
  mkdir -p "$RUNTIME_DIR"
  python3 - "$PIN_FILE" "$RUNTIME_DIR/package.json" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
dependencies = {**pin["npm"]["packages"], **pin["npm"]["runtimePeers"]["packages"]}
payload = {
    "name": "@major/dsh-runtime",
    "private": True,
    "version": "0.0.0",
    "dependencies": dependencies,
}
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
}

install_runtime_packages() {
  local package_specs=()
  local name version integrity
  while IFS=$'\t' read -r name version integrity; do
    package_specs+=("${name}@${version}")
  done < <(read_pin_packages)
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] verify npm integrity and install ${package_specs[*]} in $RUNTIME_DIR"
    return 0
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is required to install DeepSeek Harness runtime"
  fi
  while IFS=$'\t' read -r name version integrity; do
    verify_npm_integrity "$name" "$version" "$integrity"
  done < <(read_pin_packages)
  pnpm install --dir "$RUNTIME_DIR" --ignore-scripts --config.save-exact=true
  [[ -x "$RUNTIME_DIR/node_modules/.bin/dsh" ]] || fail "pinned dsh executable missing after install"
}

link_shared_runtime() {
  local profile_id="$1"
  local dest="$DSH_HOME/profiles/$profile_id"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] link shared runtime into $dest/node_modules"
    return 0
  fi
  if [[ -e "$dest/node_modules" && ! -L "$dest/node_modules" ]]; then
    fail "refusing to replace non-symlink profile node_modules: $dest/node_modules"
  fi
  if [[ -L "$dest/node_modules" ]]; then
    unlink "$dest/node_modules"
  fi
  ln -s "$RUNTIME_DIR/node_modules" "$dest/node_modules"
}

link_kernel_bundle() {
  local scope_dir="$RUNTIME_DIR/node_modules/@major"
  local dest="$scope_dir/dsh-kernel"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] link $KERNEL_DEST into the shared runtime"
    return 0
  fi
  mkdir -p "$scope_dir"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    fail "refusing to replace non-symlink Major kernel: $dest"
  fi
  if [[ -L "$dest" ]]; then
    unlink "$dest"
  fi
  ln -s "$KERNEL_DEST" "$dest"
}

verify_profile_composition() {
  local profile_id="$1"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] compose pinned profile $profile_id from the shared runtime anchor"
    return 0
  fi
  DSH_HOME="$DSH_HOME" "$RUNTIME_DIR/node_modules/.bin/dsh" \
    --profile "$profile_id" --dump-config >/dev/null
}

stage_workstation_app() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    MAJOR_HOME="$MAJOR_HOME" MAJOR_DSH_HOME="$DSH_HOME" \
      bash "$ROOT/scripts/stage-major-workstation-app.sh" --dry-run
  else
    MAJOR_HOME="$MAJOR_HOME" MAJOR_DSH_HOME="$DSH_HOME" \
      bash "$ROOT/scripts/stage-major-workstation-app.sh"
  fi
}

write_install_record() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] write $INSTALL_RECORD"
    return 0
  fi
  mkdir -p "$DSH_HOME"
  python3 - "$INSTALL_RECORD" "$PIN_VERSION" "$PIN_COMMIT" "$DSH_HOME" <<'PY'
import json, sys, time
path, version, commit, home = sys.argv[1:5]
payload = {
    "schemaVersion": 1,
    "installedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pinVersion": version,
    "attestedCommit": commit,
    "dshHome": home,
    "phase": "cutover",
    "defaultRuntime": "dsh-local",
    "compatibilityRuntimes": ["dsh-lima", "legacy-major-lima"],
    "sessionHostEnv": "MAJOR_SESSION_HOST",
    "sessionHosts": ["claude", "codex", "cursor", "antigravity"],
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
}

echo "DeepSeek Harness pin install: ${PIN_VERSION} (${PIN_COMMIT:0:7}) -> ${DSH_HOME}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "mode: dry-run"
fi

disk_preflight
stage_profile major-workstation-web
stage_profile major-workstation-headless
stage_kernel_bundle
stage_codex_worker_home
stage_named_codex_worker_homes
write_runtime_manifest
install_runtime_packages
link_kernel_runtime
link_kernel_bundle
link_shared_runtime major-workstation-web
link_shared_runtime major-workstation-headless
verify_profile_composition major-workstation-web
verify_profile_composition major-workstation-headless
stage_workstation_app
write_install_record

echo "DeepSeek Harness pin staged. Normal trusted repository execution defaults to DSH local."
echo "DSH Lima and the legacy Major/Lima pipeline remain explicit compatibility choices."
echo "Before /major, set MAJOR_SESSION_HOST to the attaching host (claude|codex|cursor|antigravity)."
