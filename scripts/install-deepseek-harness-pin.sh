#!/usr/bin/env bash
# Install the attested DeepSeek Harness pin into an isolated DSH_HOME for strangle-phase
# shadow runs inside Lima. Live Major workers remain on Lima + official CLI/ACP.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
DSH_HOME="${MAJOR_DSH_HOME:-$MAJOR_HOME/dsh-harness}"
PIN_FILE="$ROOT/distribution/deepseek-harness/pin.json"
INSTALL_RECORD="$DSH_HOME/major-install.json"
RUNTIME_DIR="$DSH_HOME/runtime"
KERNEL_SOURCE="$ROOT/distribution/deepseek-harness/bundles/major-kernel"
KERNEL_DEST="$DSH_HOME/bundles/major-kernel"
DRY_RUN=0

usage() {
  cat <<'EOF'
install-deepseek-harness-pin.sh — stage attested DeepSeek Harness profiles (strangle prep)

  --dry-run    Print the planned actions without mutating DSH_HOME
  --help       Show this help

Also stages a reversible Major.app launcher (loopback DSH web + Chrome app-mode).

Environment:
  MAJOR_HOME      Major state root (default: ~/.major)
  MAJOR_DSH_HOME  Isolated harness home (default: $MAJOR_HOME/dsh-harness)
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
  # Remove the superseded raw-ESM split module on upgrade. The browser entry
  # is one self-contained lazy-CJS factory, as required by DSH client-modules.
  rm -f "$KERNEL_DEST/command-input.js"
  cp -f "$KERNEL_SOURCE/cordis.patch.yml" "$KERNEL_DEST/cordis.patch.yml"
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
    "phase": "strangle-prep",
    "liveTrafficRemains": "lima-cli-acp",
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
write_runtime_manifest
install_runtime_packages
link_kernel_bundle
link_shared_runtime major-workstation-web
link_shared_runtime major-workstation-headless
verify_profile_composition major-workstation-web
verify_profile_composition major-workstation-headless
stage_workstation_app
write_install_record

echo "DeepSeek Harness pin staged. Live Major execution remains on Lima + official CLI/ACP."
echo "Before /major, set MAJOR_SESSION_HOST to the attaching host (claude|codex|cursor|antigravity)."
