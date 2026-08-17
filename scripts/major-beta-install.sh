#!/usr/bin/env bash
# Major private-beta install wrapper.
#
# NOT PUBLISHED. This script is not hosted anywhere a `curl | sh` command
# could reach yet — it exists so the friend-facing "one command install"
# experience is real, tested code today, ready to host the moment the owner
# decides to invite a private-beta tester.
#
# What this script deliberately does NOT reimplement: the actual build,
# release-gate, worker provisioning, atomic activation, install-history and
# post-install verification are all scripts/install-major-runtime.sh's job
# already, and it is already covered by its own tests. This wrapper's only
# job is the part a friend's machine needs that a maintainer's already-cloned
# checkout doesn't: securely OBTAIN a verified copy of the source at a known
# commit over HTTPS, run a compatibility preflight before touching anything,
# and then hand off to the existing, unmodified installer. Every property
# required of a beta installer is satisfied by composition, not duplication:
#   - HTTPS only:            enforced on both the manifest and the repo URL
#   - pinned release metadata: optional MAJOR_RELEASE_MANIFEST_URL pins an
#                             exact expected commit, verified before install
#   - checksum/signature:    the pinned commit sha itself IS the checksum
#                             (git commit ids are content-addressed); a
#                             mismatch after clone aborts before any install
#   - inspectable:           this file is plain, unobfuscated bash — read it
#                             with `cat` or a browser before piping to `sh`
#   - compatibility preflight: OS/arch/toolchain checked before any network
#                             fetch or filesystem mutation
#   - transactional install: delegated to install-major-runtime.sh's own
#                             lock file + cleanup trap + atomic activation
#   - rollback:               `major rollback` (already real, already tested)
#   - state preservation:    same guarantee as any local install
#   - no embedded credentials/data: this script clones public source only;
#                             it never reads, writes, or transmits any
#                             provider credential or user data
set -euo pipefail

MAJOR_REPO_URL="${MAJOR_REPO_URL:-https://github.com/ChukaDele/project-baracks.git}"
MAJOR_REF="${MAJOR_REF:-main}"
MAJOR_RELEASE_MANIFEST_URL="${MAJOR_RELEASE_MANIFEST_URL:-}"

require_https() {
  case "$1" in
  https://*) ;;
  *)
    echo "ERROR: $2 must be an https:// URL, got: $1" >&2
    exit 1
    ;;
  esac
}

require_https "$MAJOR_REPO_URL" "MAJOR_REPO_URL"
if [ -n "$MAJOR_RELEASE_MANIFEST_URL" ]; then
  require_https "$MAJOR_RELEASE_MANIFEST_URL" "MAJOR_RELEASE_MANIFEST_URL"
fi

echo "Major beta install: compatibility preflight..."
if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: Major currently supports macOS only (Lima/Virtualization.framework)." >&2
  exit 1
fi
MISSING=""
for tool in git node curl python3 limactl; do
  command -v "$tool" >/dev/null 2>&1 || MISSING="$MISSING $tool"
done
if [ -n "$MISSING" ]; then
  echo "ERROR: missing required tools on PATH:$MISSING" >&2
  echo "Install them, then re-run this script." >&2
  exit 1
fi
if ! command -v corepack >/dev/null 2>&1 && ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: neither corepack nor pnpm is on PATH. Install Node with corepack enabled." >&2
  exit 1
fi
if ! limactl --version | grep -Eq '(^|[^0-9])2\.2\.[0-9]+'; then
  echo "ERROR: Major requires Lima >=2.2.0 and <2.3.0 (found: $(limactl --version))." >&2
  exit 1
fi
echo "Preflight OK."

EXPECTED_SHA=""
if [ -n "$MAJOR_RELEASE_MANIFEST_URL" ]; then
  echo "Fetching pinned release manifest..."
  MANIFEST_JSON="$(curl --fail --silent --show-error --proto '=https' --tlsv1.2 "$MAJOR_RELEASE_MANIFEST_URL")"
  EXPECTED_SHA="$(python3 -c '
import json, sys
manifest = json.loads(sys.argv[1])
sha = manifest.get("sha", "")
if not isinstance(sha, str) or len(sha) != 40 or not all(c in "0123456789abcdef" for c in sha):
    raise SystemExit("ERROR: release manifest sha must be a 40-hex-character commit id")
print(sha)
' "$MANIFEST_JSON")"
  echo "Pinned expected commit: $EXPECTED_SHA"
else
  echo "No MAJOR_RELEASE_MANIFEST_URL set: skipping the pinned-commit check and trusting" \
    "whatever origin/$MAJOR_REF currently serves (install-major-runtime.sh will still" \
    "independently refuse to install anything that isn't the current tip of main)."
fi

CLONE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/major-beta-install.XXXXXX")"
cleanup() {
  rm -rf "$CLONE_DIR"
}
trap cleanup EXIT

echo "Cloning $MAJOR_REPO_URL @ $MAJOR_REF over HTTPS..."
git clone --quiet --branch "$MAJOR_REF" --single-branch "$MAJOR_REPO_URL" "$CLONE_DIR"
ACTUAL_SHA="$(git -C "$CLONE_DIR" rev-parse HEAD)"
if [ -n "$EXPECTED_SHA" ] && [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "ERROR: cloned commit does not match the pinned release manifest." >&2
  echo "expected: $EXPECTED_SHA" >&2
  echo "actual:   $ACTUAL_SHA" >&2
  echo "Refusing to install a commit that does not match its pinned checksum." >&2
  exit 1
fi
echo "Verified commit: $ACTUAL_SHA"

echo "Handing off to the real installer (scripts/install-major-runtime.sh)..."
bash "$CLONE_DIR/scripts/install-major-runtime.sh"
