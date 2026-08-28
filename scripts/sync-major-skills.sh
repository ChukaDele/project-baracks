#!/usr/bin/env bash
set -euo pipefail

MAJOR_HOME="${MAJOR_HOME:-$HOME/.major}"
SOURCE_ROOT="${1:-}"
REPO_URL="${MAJOR_SKILLS_REPO_URL:-https://github.com/ChukaDele/project-baracks.git}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/major-skill-sync.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$SOURCE_ROOT" ]; then
  SOURCE_ROOT="$(python3 - "$SOURCE_ROOT" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).expanduser().resolve())
PY
)"
  [ -d "$SOURCE_ROOT/skills/internal" ] || { echo "ERROR: skill source has no skills/internal: $SOURCE_ROOT" >&2; exit 2; }
  if git -C "$SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
    if [ -n "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=all)" ]; then
      echo "ERROR: refusing to sync Major skills from a dirty checkout: $SOURCE_ROOT" >&2
      exit 1
    fi
  else
    echo "ERROR: local skill source must be a git checkout so provenance is exact: $SOURCE_ROOT" >&2
    exit 1
  fi
else
  SOURCE_ROOT="$TMP/source"
  echo "Fetching current Major skills from origin/main..."
  git clone --quiet --depth 1 --branch main "$REPO_URL" "$SOURCE_ROOT"
  SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
fi

REGISTRY="$SOURCE_ROOT/guidance/skills.registry.json"
RECONCILIATION_LEDGER="$SOURCE_ROOT/guidance/skills-reconciliation-ledger.json"
INTERNAL="$SOURCE_ROOT/skills/internal"
EVALS="$SOURCE_ROOT/evals/skill-resolver"
ASSETS="$SOURCE_ROOT/guidance/reusable-assets.registry.json"
GBRAIN_ASSETS="$SOURCE_ROOT/guidance/gbrain-reusable-assets.index.json"
ASSET_CANDIDATES="$SOURCE_ROOT/guidance/reusable-assets.candidates.json"
CAPABILITY_MATRIX="$SOURCE_ROOT/guidance/worker-capability-matrix.json"
SOURCE_LEDGER="$SOURCE_ROOT/package/source-ledger.json"
VENDOR_SOURCES="$SOURCE_ROOT/guidance/vendor-sources.json"
for required in "$REGISTRY" "$RECONCILIATION_LEDGER" "$ASSETS" "$GBRAIN_ASSETS" "$ASSET_CANDIDATES" "$CAPABILITY_MATRIX" "$SOURCE_LEDGER" "$VENDOR_SOURCES" "$INTERNAL" "$EVALS"; do
  [ -e "$required" ] || { echo "ERROR: required skill-bundle source missing: $required" >&2; exit 1; }
done

# Validate the complete knowledge bundle before mutating active Major state.
REGISTRY_VERSION="$(python3 - "$REGISTRY" "$INTERNAL" "$EVALS" "$ASSETS" "$VENDOR_SOURCES" <<'PY'
import json
import re
import sys
from pathlib import Path

registry_path = Path(sys.argv[1])
internal_root = Path(sys.argv[2])
evals_root = Path(sys.argv[3])
assets_path = Path(sys.argv[4])
vendor_sources_path = Path(sys.argv[5])
registry = json.loads(registry_path.read_text())
version = registry.get('version')
entries = registry.get('entries')
if not isinstance(version, int) or version < 1 or not isinstance(entries, list):
    raise SystemExit('ERROR: invalid Major skills registry schema')
ids = []
internal_ids = []
for entry in entries:
    if not isinstance(entry, dict):
        raise SystemExit('ERROR: invalid Major skill registry entry')
    skill_id = entry.get('id')
    if not isinstance(skill_id, str) or not skill_id:
        raise SystemExit('ERROR: Major skill registry entry missing id')
    if not all(isinstance(entry.get(k), str) and entry.get(k) for k in ('source','availability','load')):
        raise SystemExit(f'ERROR: incomplete Major skill registry entry: {skill_id}')
    ids.append(skill_id)
    if entry['source'] == 'major-internal':
        internal_ids.append(skill_id)
if len(ids) != len(set(ids)):
    raise SystemExit('ERROR: duplicate Major skill ids in registry')

vendor_catalog = json.loads(vendor_sources_path.read_text())
if vendor_catalog.get('schemaVersion') != 1 or vendor_catalog.get('kind') != 'major.vendor-skill-sources' or not isinstance(vendor_catalog.get('sources'), list):
    raise SystemExit('ERROR: invalid vendor skill source catalog')
vendor_sources = {source.get('id'): source for source in vendor_catalog['sources'] if isinstance(source, dict)}
for entry in entries:
    if entry.get('sourceKind') != 'VENDOR_LIVE':
        continue
    source = vendor_sources.get(entry.get('source'))
    skills = source.get('skills', []) if isinstance(source, dict) else []
    if not any(isinstance(skill, dict) and skill.get('id') == entry.get('vendorSkill') for skill in skills):
        raise SystemExit(f"ERROR: vendor registry entry is missing from vendor catalog: {entry.get('id')}")

installed = sorted(
    path.name for path in internal_root.iterdir()
    if path.is_dir() and (path / 'SKILL.md').is_file()
)
registered = sorted(internal_ids)
missing = sorted(set(registered) - set(installed))
orphan = sorted(set(installed) - set(registered))
if missing or orphan:
    raise SystemExit(f'ERROR: skill registry/tree mismatch missing={missing} orphan={orphan}')

for skill_id in installed:
    text = (internal_root / skill_id / 'SKILL.md').read_text()
    if not text.startswith('---\n'):
        raise SystemExit(f'ERROR: {skill_id}/SKILL.md missing frontmatter')
    end = text.find('\n---\n', 4)
    if end < 0:
        raise SystemExit(f'ERROR: {skill_id}/SKILL.md has malformed frontmatter')
    frontmatter = text[4:end]
    name = re.search(r'^name:\s*(.+?)\s*$', frontmatter, re.MULTILINE)
    description = re.search(r'^description:\s*(.+?)\s*$', frontmatter, re.MULTILINE)
    if not name or name.group(1).strip() != skill_id:
        raise SystemExit(f'ERROR: {skill_id}/SKILL.md frontmatter name mismatch')
    if not description or not description.group(1).strip():
        raise SystemExit(f'ERROR: {skill_id}/SKILL.md missing description')

known = set(ids)
for path in evals_root.glob('*.json'):
    data = json.loads(path.read_text())
    skill = data.get('skill')
    if not isinstance(skill, str) or skill not in known:
        raise SystemExit(f'ERROR: resolver eval references unknown skill: {path.name}')
    if not isinstance(data.get('should_trigger'), list) or not isinstance(data.get('should_not_trigger'), list):
        raise SystemExit(f'ERROR: malformed resolver eval: {path.name}')

asset_catalog = json.loads(assets_path.read_text())
assets = asset_catalog.get('assets')
if not isinstance(asset_catalog.get('version'), int) or not isinstance(assets, list):
    raise SystemExit('ERROR: invalid reusable asset registry schema')
asset_ids = []
source_root = registry_path.parent.parent.resolve()
for asset in assets:
    if not isinstance(asset, dict) or asset.get('lifecycle') not in {
        'LOCAL', 'REUSE_CANDIDATE', 'EVALUATED', 'PROMOTED', 'MONITORED', 'UPDATED', 'DEPRECATED'
    } or not isinstance(asset.get('tags'), list) or not isinstance(asset.get('provenance'), dict) or not isinstance(asset.get('evidence'), dict):
        raise SystemExit('ERROR: reusable asset has incomplete lifecycle metadata')
    if not all(isinstance(asset.get(k), str) and asset.get(k) for k in ('id','kind','title','summary','locator')):
        raise SystemExit('ERROR: incomplete reusable asset metadata')
    asset_ids.append(asset['id'])
    target = (source_root / asset['locator']).resolve()
    if source_root not in target.parents or not target.is_file():
        raise SystemExit(f"ERROR: reusable asset locator is unavailable or escapes source: {asset['locator']}")
if len(asset_ids) != len(set(asset_ids)):
    raise SystemExit('ERROR: duplicate reusable asset ids')

print(version)
PY
)"

BUNDLES="$MAJOR_HOME/skill-bundles"
DEST="$BUNDLES/$SHA"
STAGED="$BUNDLES/.stage-$SHA-$$"
mkdir -p "$BUNDLES"
PREVIOUS_BUNDLE="$(python3 - "$BUNDLES/current" <<'PY'
import json
import re
import sys
from pathlib import Path
current = Path(sys.argv[1])
try:
    marker = json.loads((current.resolve() / 'bundle.json').read_text())
    sha = marker.get('sha')
    print(sha if isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{40}(?:[0-9a-f]{24})?', sha) else '')
except Exception:
    print('')
PY
)"
rm -rf "$STAGED"
mkdir -p "$STAGED/guidance" "$STAGED/package" "$STAGED/skills" "$STAGED/evals"
cp "$REGISTRY" "$STAGED/guidance/skills.registry.json"
cp "$RECONCILIATION_LEDGER" "$STAGED/guidance/skills-reconciliation-ledger.json"
cp "$CAPABILITY_MATRIX" "$STAGED/guidance/worker-capability-matrix.json"
cp "$VENDOR_SOURCES" "$STAGED/guidance/vendor-sources.json"
cp "$SOURCE_LEDGER" "$STAGED/package/source-ledger.json"
cp "$ASSETS" "$STAGED/guidance/reusable-assets.registry.json"
cp "$GBRAIN_ASSETS" "$STAGED/guidance/gbrain-reusable-assets.index.json"
cp "$ASSET_CANDIDATES" "$STAGED/guidance/reusable-assets.candidates.json"
cp -R "$INTERNAL" "$STAGED/skills/internal"
cp -R "$EVALS" "$STAGED/evals/skill-resolver"
python3 - "$ASSETS" <<'PY' | while IFS= read -r locator; do
import json
import sys
for asset in json.load(open(sys.argv[1])).get('assets', []):
    print(asset['locator'])
PY
  mkdir -p "$STAGED/$(dirname "$locator")"
  cp "$SOURCE_ROOT/$locator" "$STAGED/$locator"
done
python3 - "$STAGED/bundle.json" "$SHA" "$REGISTRY_VERSION" "$SOURCE_ROOT" "$PREVIOUS_BUNDLE" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    'version': 1,
    'sha': sys.argv[2],
    'registryVersion': int(sys.argv[3]),
    'source': sys.argv[4],
    'installedAt': datetime.now(timezone.utc).isoformat(),
    **({'previousBundle': sys.argv[5]} if sys.argv[5] else {}),
}, indent=2) + '\n')
PY

# Activation is pointer-based: the complete validated bundle is installed first,
# then one atomic symlink replacement changes what every new Major resolution sees.
if [ -e "$DEST" ]; then
  rm -rf "$DEST"
fi
mv "$STAGED" "$DEST"
NEXT="$BUNDLES/.current-$$"
ln -s "$SHA" "$NEXT"
python3 - "$NEXT" "$BUNDLES/current" <<'PY'
import os
import sys
os.replace(sys.argv[1], sys.argv[2])
PY

# Keep the active bundle plus the two most recent rollback bundles. Skill bundles
# are small, but Major still owns their lifecycle and should converge in space.
python3 - "$BUNDLES" "$SHA" "$PREVIOUS_BUNDLE" <<'PY'
import json
import re
import shutil
import sys
from pathlib import Path
root = Path(sys.argv[1])
active = sys.argv[2]
previous = sys.argv[3]
rows = []
for path in root.iterdir():
    if not path.is_dir() or path.is_symlink() or path.name.startswith('.'):
        continue
    if path.name == active:
        continue
    try:
        marker = json.loads((path / 'bundle.json').read_text())
        sha = marker.get('sha')
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}(?:[0-9a-f]{24})?', sha):
            continue
        rows.append((sha == previous, path.stat().st_mtime, path))
    except Exception:
        continue
rows.sort(key=lambda row: (row[0], row[1]), reverse=True)
for _, _, path in rows[2:]:
    shutil.rmtree(path)
PY

echo "Major hot skills synced and activated"
echo "SHA: $SHA"
echo "Registry version: $REGISTRY_VERSION"
echo "Active bundle: $DEST"
