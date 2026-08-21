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
MAJOR_CONTROL_PLANE_DEST="$DSH_HOME/native-major"
MAJOR_CONTROL_PLANE_MARKER="$MAJOR_CONTROL_PLANE_DEST/major-control-plane.json"
MAJOR_PRESET_SOURCE="$ROOT/distribution/deepseek-harness/agent-presets/major"
APP_DIR="${MAJOR_APP_DIR:-/Applications}"
APP_DEST="$APP_DIR/Major.app"
APP_MARKER_REL="Contents/Resources/major-dsh-installer-owned"
APP_MARKER_VALUE="major-dsh-workstation-app-v1"
APP_TRANSACTION_BACKUP=""
APP_EXISTED_BEFORE_TRANSACTION=0
APP_BACKED_UP=0
APP_ACTIVATED=0
DRY_RUN=0
TRANSACTION_DIR=""
TRANSACTION_ACTIVE=0
MANAGED_PATHS=(
  "runtime"
  "profiles/major-workstation-web"
  "profiles/major-workstation-headless"
  "bundles/major-kernel"
  "native-major"
  "providers/codex"
  "bin/start-major-workstation.sh"
  "major-install.json"
)

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
  MAJOR_APP_DIR   Major.app parent directory (default: /Applications)
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
  if [[ "${MAJOR_DSH_TEST_SKIP_DISK_PREFLIGHT:-0}" == "1" ]]; then
    [[ "${NODE_ENV:-}" == "test" ]] || fail "disk preflight bypass is test-only"
    echo "disk preflight skipped by test fixture"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] disk preflight before DSH/Lima install"
    return 0
  fi
  local stats
  stats="$(require_disk_headroom)"
  echo "disk preflight ok: ${stats%%$'\t'*}% free"
}

begin_managed_transaction() {
  [[ "$DRY_RUN" -eq 0 ]] || return 0
  if [[ -e "$APP_DEST" || -L "$APP_DEST" ]]; then
    [[ -d "$APP_DEST" && ! -L "$APP_DEST" ]] || \
      fail "refusing to transact unmarked app: $APP_DEST"
    [[ -f "$APP_DEST/$APP_MARKER_REL" ]] || \
      fail "refusing to transact unmarked app: $APP_DEST"
    [[ "$(cat "$APP_DEST/$APP_MARKER_REL")" == "$APP_MARKER_VALUE" ]] || \
      fail "refusing to transact unmarked app: $APP_DEST"
    APP_EXISTED_BEFORE_TRANSACTION=1
  fi
  mkdir -p "$DSH_HOME"
  TRANSACTION_DIR="$(mktemp -d "$DSH_HOME/.install-rollback.XXXXXX")"
  mkdir -p "$TRANSACTION_DIR/backup"
  : > "$TRANSACTION_DIR/existing"
  TRANSACTION_ACTIVE=1
  trap rollback_managed_transaction EXIT
  local relative
  for relative in "${MANAGED_PATHS[@]}"; do
    if [[ -e "$DSH_HOME/$relative" || -L "$DSH_HOME/$relative" ]]; then
      printf '%s\n' "$relative" >> "$TRANSACTION_DIR/existing"
      mkdir -p "$TRANSACTION_DIR/backup/$(dirname "$relative")"
      # The rollback runtime stays on the same volume and is renamed, not
      # copied. This preserves bytes/metadata without doubling a large pin.
      mv "$DSH_HOME/$relative" "$TRANSACTION_DIR/backup/$relative"
    fi
  done
  if [[ "$APP_EXISTED_BEFORE_TRANSACTION" -eq 1 ]]; then
    mkdir -p "$APP_DIR"
    APP_TRANSACTION_BACKUP="$APP_DIR/.Major.app.install-rollback.$$"
    [[ ! -e "$APP_TRANSACTION_BACKUP" && ! -L "$APP_TRANSACTION_BACKUP" ]] || \
      fail "app rollback path already exists: $APP_TRANSACTION_BACKUP"
    mv "$APP_DEST" "$APP_TRANSACTION_BACKUP"
    APP_BACKED_UP=1
  fi
}

rollback_managed_transaction() {
  local exit_code=$?
  [[ "$TRANSACTION_ACTIVE" -eq 1 ]] || return "$exit_code"
  trap - EXIT
  local relative
  for relative in "${MANAGED_PATHS[@]}"; do
    rm -rf "$DSH_HOME/$relative"
  done
  if [[ "$APP_BACKED_UP" -eq 1 ]]; then
    rm -rf "$APP_DEST"
    mv "$APP_TRANSACTION_BACKUP" "$APP_DEST"
  elif [[ "$APP_ACTIVATED" -eq 1 ]]; then
    rm -rf "$APP_DEST"
  fi
  while IFS= read -r relative; do
    mkdir -p "$DSH_HOME/$(dirname "$relative")"
    mv "$TRANSACTION_DIR/backup/$relative" "$DSH_HOME/$relative"
  done < "$TRANSACTION_DIR/existing"
  rm -rf "$TRANSACTION_DIR"
  echo "DSH PIN INSTALL ROLLED BACK: prior installer-managed state restored" >&2
  exit "$exit_code"
}

commit_managed_transaction() {
  [[ "$TRANSACTION_ACTIVE" -eq 1 ]] || return 0
  TRANSACTION_ACTIVE=0
  if [[ "$APP_BACKED_UP" -eq 1 ]]; then
    rm -rf "$APP_TRANSACTION_BACKUP"
  fi
  rm -rf "$TRANSACTION_DIR"
  trap - EXIT
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
  cp -f "$KERNEL_SOURCE/route-context.js" "$KERNEL_DEST/route-context.js"
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

stage_major_control_plane() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage compiled Major control plane -> $MAJOR_CONTROL_PLANE_DEST"
    echo "[dry-run] install production control-plane dependencies in $MAJOR_CONTROL_PLANE_DEST/node_modules"
    return 0
  fi
  local source_path
  for source_path in \
    "$ROOT/dist/entry.js" \
    "$ROOT/package.json" \
    "$ROOT/pnpm-lock.yaml" \
    "$ROOT/drizzle" \
    "$ROOT/guidance/skills.registry.json" \
    "$ROOT/skills/internal" \
    "$ROOT/evals/skill-resolver"; do
    [[ -e "$source_path" ]] || fail "compiled Major control-plane artifact is missing: $source_path (run pnpm build first)"
  done
  command -v pnpm >/dev/null 2>&1 || fail "pnpm is required to stage the Major control-plane dependencies"
  mkdir -p "$MAJOR_CONTROL_PLANE_DEST"
  cp -R "$ROOT/dist" "$MAJOR_CONTROL_PLANE_DEST/dist"
  cp -f "$ROOT/package.json" "$MAJOR_CONTROL_PLANE_DEST/package.json"
  cp -f "$ROOT/pnpm-lock.yaml" "$MAJOR_CONTROL_PLANE_DEST/pnpm-lock.yaml"
  cp -R "$ROOT/drizzle" "$MAJOR_CONTROL_PLANE_DEST/drizzle"
  mkdir -p "$MAJOR_CONTROL_PLANE_DEST/guidance" "$MAJOR_CONTROL_PLANE_DEST/skills" "$MAJOR_CONTROL_PLANE_DEST/evals"
  cp -f "$ROOT/guidance/skills.registry.json" "$MAJOR_CONTROL_PLANE_DEST/guidance/skills.registry.json"
  cp -R "$ROOT/skills/internal" "$MAJOR_CONTROL_PLANE_DEST/skills/internal"
  cp -R "$ROOT/evals/skill-resolver" "$MAJOR_CONTROL_PLANE_DEST/evals/skill-resolver"
  pnpm install --dir "$MAJOR_CONTROL_PLANE_DEST" --prod --offline --frozen-lockfile --ignore-scripts
  mkdir -p "$MAJOR_CONTROL_PLANE_DEST/bin"
  cat > "$MAJOR_CONTROL_PLANE_DEST/bin/major" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/dist/entry.js" "$@"
EOF
  chmod 755 "$MAJOR_CONTROL_PLANE_DEST/bin/major"
  python3 - "$MAJOR_CONTROL_PLANE_MARKER" "$PIN_VERSION" "$PIN_COMMIT" "$ROOT" "$KERNEL_SOURCE/index.js" "$MAJOR_CONTROL_PLANE_DEST/dist" <<'PY'
import hashlib, json, subprocess, sys, time
from pathlib import Path

marker = Path(sys.argv[1])
version = sys.argv[2]
pin_commit = sys.argv[3]
source_root = Path(sys.argv[4])
kernel_entry = Path(sys.argv[5])
control_plane_dist = Path(sys.argv[6])

def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def sha256_tree(root):
    digest = hashlib.sha256()
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()

commit = subprocess.check_output(
    ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True
).strip()
dirty = subprocess.run(
    ["git", "-C", str(source_root), "diff", "--quiet", "--ignore-submodules", "--"],
    check=False,
).returncode != 0
kernel_sha = sha256_file(kernel_entry)
control_plane_sha = sha256_tree(control_plane_dist)
installation_id = hashlib.sha256(
    f"{version}\0{pin_commit}\0{kernel_sha}\0{control_plane_sha}".encode("utf-8")
).hexdigest()
payload = {
    "schemaVersion": 1,
    "installationId": installation_id,
    "installedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "dshPin": {"version": version, "attestedCommit": pin_commit},
    "source": {
        "commit": commit,
        "dirty": dirty,
        "kernelEntrySha256": kernel_sha,
        "controlPlaneDistSha256": control_plane_sha,
    },
    "artifact": {"entrypoint": "bin/major", "runtime": "node", "dependencies": "production"},
}
marker.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
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

stage_major_system_preset() {
  local preset_root="$RUNTIME_DIR/node_modules/@deepseek-ai/dsh/config/agent-presets"
  local destination="$preset_root/major"
  [[ -f "$MAJOR_PRESET_SOURCE/agent.cordis.yml" ]] || \
    fail "missing Major system preset composition: $MAJOR_PRESET_SOURCE/agent.cordis.yml"
  [[ -f "$MAJOR_PRESET_SOURCE/preset.yml" ]] || \
    fail "missing Major system preset metadata: $MAJOR_PRESET_SOURCE/preset.yml"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] stage Major system preset $MAJOR_PRESET_SOURCE -> $destination"
    return 0
  fi
  [[ -d "$preset_root/standard" ]] || fail "pinned DSH system preset root missing: $preset_root"
  mkdir -p "$destination"
  cp -f "$MAJOR_PRESET_SOURCE/agent.cordis.yml" "$destination/agent.cordis.yml"
  cp -f "$MAJOR_PRESET_SOURCE/preset.yml" "$destination/preset.yml"
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
  local composition_output
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] compose pinned profile $profile_id from the shared runtime anchor"
    return 0
  fi
  if ! composition_output="$(
    DSH_HOME="$DSH_HOME" "$RUNTIME_DIR/node_modules/.bin/dsh" \
      --profile "$profile_id" --dump-config 2>&1
  )"; then
    printf '%s\n' "$composition_output" >&2
    fail "DSH profile composition failed: $profile_id"
  fi
  if printf '%s\n' "$composition_output" | grep -Eiq \
    '(^|[[:space:]])error(:|[[:space:]])|patch:[[:space:]]*entry .* not found'; then
    printf '%s\n' "$composition_output" >&2
    fail "DSH profile composition reported an error: $profile_id"
  fi
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
  python3 - "$INSTALL_RECORD" "$PIN_VERSION" "$PIN_COMMIT" "$DSH_HOME" "$MAJOR_CONTROL_PLANE_MARKER" <<'PY'
import json, sys, time
path, version, commit, home, control_plane_marker = sys.argv[1:6]
control_plane = json.load(open(control_plane_marker, encoding="utf-8"))
payload = {
    "schemaVersion": 1,
    "installedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pinVersion": version,
    "attestedCommit": commit,
    "dshHome": home,
    "phase": "cutover",
    "defaultRuntime": "dsh-local",
    "compatibilityRuntimes": ["dsh-lima", "legacy-major-lima"],
    "nativeInteractionOrigin": "major-app/dsh",
    "externalSessionHostEnv": "MAJOR_SESSION_HOST",
    "externalSessionHosts": ["claude", "codex", "cursor", "antigravity"],
    "nativeControlPlane": {
        "entrypoint": "native-major/bin/major",
        "marker": "native-major/major-control-plane.json",
        "installationId": control_plane["installationId"],
        "sourceCommit": control_plane["source"]["commit"],
        "sourceDirty": control_plane["source"]["dirty"],
    },
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
begin_managed_transaction
stage_profile major-workstation-web
stage_profile major-workstation-headless
stage_kernel_bundle
stage_codex_worker_home
stage_named_codex_worker_homes
write_runtime_manifest
install_runtime_packages
stage_major_system_preset
link_kernel_runtime
link_kernel_bundle
link_shared_runtime major-workstation-web
link_shared_runtime major-workstation-headless
stage_major_control_plane
verify_profile_composition major-workstation-web
if [[ "${MAJOR_DSH_TEST_FAIL_AFTER_COMPOSITION:-0}" == "1" ]]; then
  fail "injected failure after web profile composition"
fi
verify_profile_composition major-workstation-headless
APP_ACTIVATED=1
stage_workstation_app
if [[ "${MAJOR_DSH_TEST_FAIL_AFTER_APP_ACTIVATION:-0}" == "1" ]]; then
  fail "injected failure after app activation"
fi
write_install_record
commit_managed_transaction

echo "DeepSeek Harness pin staged. Normal trusted repository execution defaults to DSH local."
echo "DSH Lima and the legacy Major/Lima pipeline remain explicit compatibility choices."
echo "Native Major.app records interaction origin major-app/dsh; MAJOR_SESSION_HOST is only for /major from an external host."
echo "Native Major.app uses the co-versioned control plane at $MAJOR_CONTROL_PLANE_DEST/bin/major."
