#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "MAJOR VALIDATION FAILED: $*" >&2; exit 1; }

# 1. Basic syntax / machine-readable files.
for script in scripts/*.sh; do bash -n "$script" || fail "shell syntax: $script"; done
python3 - <<'PY'
import json
from pathlib import Path
for p in Path('.').rglob('*.json'):
    try:
        json.loads(p.read_text())
    except Exception as e:
        raise SystemExit(f"invalid JSON: {p}: {e}")
PY

# 2. Active guidance registry: every path exists, ids are unique, and critical Major rules are active.
python3 - <<'PY'
import json
from pathlib import Path
reg = json.loads(Path('guidance/instructions.registry.json').read_text())
entries = reg['entries']
ids = [e['id'] for e in entries]
if len(ids) != len(set(ids)):
    raise SystemExit('duplicate active guidance ids')
for e in entries:
    if e.get('status') != 'active':
        raise SystemExit(f"non-active entry left in active registry: {e['id']}")
    if not Path(e['path']).is_file():
        raise SystemExit(f"missing guidance file: {e['path']}")
required = {
    'communication-style', 'mvp-speed-and-prioritisation', 'autonomy-and-progress',
    'legacy-cleanup', 'security-and-permissions', 'ui-patterns-and-reuse',
    'task-scope', 'model-routing', 'human-approval'
}
missing = required - set(ids)
if missing:
    raise SystemExit(f"required Major guidance missing: {sorted(missing)}")
PY

# 3. Internal skill registry must exactly cover Major-owned skill directories.
python3 - <<'PY'
import json
from pathlib import Path
reg = json.loads(Path('guidance/skills.registry.json').read_text())
entries = reg['entries']
ids = [e['id'] for e in entries]
if len(ids) != len(set(ids)):
    raise SystemExit('duplicate skill ids')
registered_internal = {e['id'] for e in entries if e.get('source') == 'major-internal'}
actual_internal = {p.name for p in Path('skills/internal').iterdir() if p.is_dir() and (p/'SKILL.md').is_file()}
if registered_internal != actual_internal:
    raise SystemExit(
        'internal skill registry mismatch\n'
        f"missing from registry: {sorted(actual_internal-registered_internal)}\n"
        f"missing on disk: {sorted(registered_internal-actual_internal)}"
    )
policy = reg.get('policy', {})
for key in ['installedDoesNotMeanLoaded','externalSkillsAreSubordinateToMajorGuidance','fullEmilBundle','mvpIsDefault','legacyCleanupRequired']:
    if policy.get(key) is not True:
        raise SystemExit(f"required skill policy not enabled: {key}")
PY

# 4. Deleted v1 documents/project-specific core examples must not return.
for path in \
  docs/deferred-security-milestones.md \
  docs/provider-routing.md \
  docs/security-model.md \
  docs/surface-talent-integration.md \
  docs/roadmap-sync.md \
  examples/surface-talent.project.json; do
  [ ! -e "$path" ] || fail "obsolete v1 file returned: $path"
done

# 5. Stale concepts must not appear in active rules/templates/README.
for phrase in \
  "disabled architectural foundation" \
  "Codex is skipped entirely" \
  "Never delete a guidance file" \
  "Google Sheets for Surface Talent" \
  "Figma-first"; do
  if grep -R -F -n --exclude='validate-major.sh' "$phrase" README.md guidance templates 2>/dev/null; then
    fail "stale active phrase found: $phrase"
  fi
done

# 6. Explicit doctrine checks: keep these small and hard to game.
grep -Fq "MVP is the default delivery strategy" guidance/mvp-speed-and-prioritisation.md || fail "MVP default doctrine missing"
grep -Fq "Git history is the audit archive" guidance/instruction-precedence.md || fail "clean supersession doctrine missing"
grep -Fq "continue until" guidance/autonomy-and-progress.md || fail "continue-until autonomy doctrine missing"
grep -Fq "ASD-STE100-inspired" guidance/communication-style.md || fail "communication standard missing"
grep -Fq "complete current upstream bundle" docs/skills-catalog.md || fail "full Emil bundle policy missing"
grep -Fq "Remove only skills previously installed by Major" scripts/install-major-skills.sh || fail "stale skill cleanup missing"

# 7. Provider-specific contamination: canonical roadmap/state guidance must remain provider-neutral.
if grep -E -n "Surface Talent|spreadsheetId|Google Sheets for" guidance/roadmap-sync.md; then
  fail "provider/client-specific roadmap assumption in global guidance"
fi

# 8. Bootstrap contract exists and uses provider-neutral AGENTS + profile skills.
[ -f templates/project/major-core.md ] || fail "project core template missing"
[ -f scripts/bootstrap-major-project.sh ] || fail "project bootstrap missing"
grep -Fq "AGENTS.md" scripts/bootstrap-major-project.sh || fail "provider-neutral AGENTS bootstrap missing"
grep -Fq "install-major-skills.sh" scripts/bootstrap-major-project.sh || fail "skill-profile bootstrap missing"

echo "Major validation passed."
