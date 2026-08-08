#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "MAJOR VALIDATION FAILED: $*" >&2; exit 1; }

for script in scripts/*.sh; do bash -n "$script" || fail "shell syntax: $script"; done
python3 -m py_compile scripts/major-antigravity-worker.py || fail "Antigravity worker Python syntax"
python3 - <<'PY'
import json
from pathlib import Path
for p in Path('.').rglob('*.json'):
    try:
        json.loads(p.read_text())
    except Exception as e:
        raise SystemExit(f"invalid JSON: {p}: {e}")
PY

python3 - <<'PY'
import json
from pathlib import Path
reg = json.loads(Path('guidance/instructions.registry.json').read_text())
if reg.get('version') != 1:
    raise SystemExit('guidance registry schema version must remain 1; use Git for document revision history')
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
    'communication-style', 'readiness-and-independent-validation',
    'tool-routing-and-source-ingestion', 'mvp-speed-and-prioritisation',
    'autonomy-and-progress', 'legacy-cleanup', 'security-and-permissions',
    'ui-patterns-and-reuse', 'task-scope', 'model-routing', 'human-approval',
    'roadmap-sync'
}
missing = required - set(ids)
if missing:
    raise SystemExit(f"required Major guidance missing: {sorted(missing)}")
PY

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
for required_skill in ['source-ingestion', 'knowledge-work', 'skill-resolver', 'skillify', 'tools-as-code']:
    if required_skill not in registered_internal:
        raise SystemExit(f"required Major skill missing: {required_skill}")
policy = reg.get('policy', {})
for key in [
    'installedDoesNotMeanLoaded',
    'externalSkillsAreSubordinateToMajorGuidance',
    'fullEmilBundle',
    'mvpIsDefault',
    'legacyCleanupRequired',
    'primarySourceBeforeReconstruction',
    'skillifyReusableProcedures',
    'toolsAsCodeForRepeatedDeterministicWork',
]:
    if policy.get(key) is not True:
        raise SystemExit(f"required skill policy not enabled: {key}")
PY

for path in \
  docs/deferred-security-milestones.md \
  docs/provider-routing.md \
  docs/security-model.md \
  docs/surface-talent-integration.md \
  docs/roadmap-sync.md \
  examples/surface-talent.project.json \
  scripts/install-major-global-style.sh; do
  [ ! -e "$path" ] || fail "obsolete file returned: $path"
done

for phrase in \
  "disabled architectural foundation" \
  "Codex is skipped entirely" \
  "Never delete a guidance file" \
  "Google Sheets for Surface Talent" \
  "Figma-first" \
  "No live agent execution, merge, deploy"; do
  if grep -R -F -n --exclude='validate-major.sh' "$phrase" README.md guidance templates .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null; then
    fail "stale active phrase found: $phrase"
  fi
done

grep -Fq "MVP is the default delivery strategy" guidance/mvp-speed-and-prioritisation.md || fail "MVP default doctrine missing"
grep -Fq "Git history is the audit archive" guidance/instruction-precedence.md || fail "clean supersession doctrine missing"
grep -Fiq "continue until" guidance/autonomy-and-progress.md || fail "continue-until autonomy doctrine missing"
grep -Fq "ASD-STE100-inspired" guidance/communication-style.md || fail "communication standard missing"
grep -Fq "BUILT" guidance/readiness-and-independent-validation.md || fail "built/validated/ready distinction missing"
grep -Fq "independent grader" guidance/readiness-and-independent-validation.md || fail "independent grader rule missing"
grep -Fq "A failed first tool is not a failed task" guidance/tool-routing-and-source-ingestion.md || fail "tool fallback doctrine missing"
grep -Fq "Do not search for articles about the video" guidance/tool-routing-and-source-ingestion.md || fail "YouTube primary-source guard missing"
grep -Fq "complete current upstream bundle" docs/skills-catalog.md || fail "full Emil bundle policy missing"
grep -Fq "Remove only skills previously installed by Major" scripts/install-major-skills.sh || fail "stale skill cleanup missing"

if grep -E -n "Surface Talent|spreadsheetId|Google Sheets for" guidance/roadmap-sync.md; then
  fail "provider/client-specific roadmap assumption in global guidance"
fi

[ -f templates/project/major-core.md ] || fail "project core template missing"
[ -f scripts/bootstrap-major-project.sh ] || fail "project bootstrap missing"
grep -Fq "AGENTS.md" scripts/bootstrap-major-project.sh || fail "provider-neutral AGENTS bootstrap missing"
grep -Fq "install-major-skills.sh" scripts/bootstrap-major-project.sh || fail "skill-profile bootstrap missing"
grep -Fq "core|knowledge|web-ui|exploratory|full" scripts/install-major-skills.sh || fail "knowledge profile missing from skill installer"
grep -Fq "A failed first tool is not a failed task" templates/project/major-core.md || fail "project tool-routing rule missing"
grep -Fq "Skill-first execution" templates/project/major-core.md || fail "project skill-first rule missing"
grep -Fq "BUILT" templates/project/major-core.md || fail "project readiness language missing"

[ -f guidance/global-worker-rules.md ] || fail "compact global worker rules missing"
[ -f scripts/install-major-global-rules.sh ] || fail "global worker rules installer missing"
grep -Fq "Use the right tool" guidance/global-worker-rules.md || fail "global tool-routing rule missing"
grep -Fq "Primary-source integrity" guidance/global-worker-rules.md || fail "global primary-source rule missing"
grep -Fq "Major is the default control plane" guidance/global-worker-rules.md || fail "Major default control-plane rule missing"
grep -Fq "Presence is not execution authority" guidance/global-worker-rules.md || fail "presence/authority separation missing"
grep -Fq "Tools as Code" guidance/global-worker-rules.md || fail "Tools-as-Code rule missing"
grep -Fq "skillify" guidance/global-worker-rules.md || fail "skillify rule missing"
grep -Fq '$HOME/.local/bin/major session attach' guidance/global-worker-rules.md || fail "GUI-safe Major attach command missing"
grep -Fq '.claude/CLAUDE.md' scripts/install-major-global-rules.sh || fail "Claude global rules target missing"
grep -Fq '.codex' scripts/install-major-global-rules.sh || fail "Codex global rules target missing"
grep -Fq '.gemini/GEMINI.md' scripts/install-major-global-rules.sh || fail "Antigravity global rules target missing"
grep -Fq '.cursor/rules/major-global/RULE.md' scripts/install-major-global-rules.sh || fail "Cursor terminal global rule target missing"
if grep -Fq 'pbcopy' scripts/install-major-global-rules.sh; then
  fail "Cursor clipboard handoff should not be primary installer path"
fi

[ -f scripts/major-ingest-youtube.sh ] || fail "YouTube ingestion script missing"
[ -f scripts/setup-major-knowledge-tools.sh ] || fail "knowledge tool setup/doctor missing"
grep -Fq "yt-dlp" scripts/major-ingest-youtube.sh || fail "YouTube ingestion missing yt-dlp"
grep -Fq "mw transcribe" scripts/major-ingest-youtube.sh || fail "YouTube ingestion missing MacWhisper fallback"
grep -Fq -- "--prefix" scripts/setup-major-knowledge-tools.sh || fail "GStack namespacing missing"
grep -Fq "proactive false" scripts/setup-major-knowledge-tools.sh || fail "GStack proactive routing must be disabled under Major"
grep -Fq "telemetry off" scripts/setup-major-knowledge-tools.sh || fail "GStack telemetry default must be off under Major setup"

grep -Fq "Major Build" docs/architecture.md || fail "Major Build profile missing"
grep -Fq "Major Knowledge" docs/architecture.md || fail "Major Knowledge profile missing"
grep -Fq "Tool/capability router" docs/architecture.md || fail "tool/capability router missing"

# Thin-kernel supervisor runtime.
[ -f src/entry.ts ] || fail "global Major supervisor entry missing"
[ -f src/supervisor/state.ts ] || fail "durable supervisor state missing"
[ -f src/supervisor/policy.ts ] || fail "project trust policy missing"
[ -f src/supervisor/runtime.ts ] || fail "supervisor goal loop missing"
[ -f src/supervisor/worker.ts ] || fail "multi-provider worker runtime missing"
[ -f src/supervisor/cli.ts ] || fail "supervisor CLI missing"
[ -f src/security/major-gateway.ts ] || fail "Major successor execution gateway missing"
[ -f scripts/install-major-runtime.sh ] || fail "runtime installer missing"

grep -Fq '"major": "./dist/entry.js"' package.json || fail "package bin must enter the supervisor runtime"
grep -Fq "supervisor-state.json" src/supervisor/state.ts || fail "durable cross-session goal state missing"
grep -Fq "project-policies.json" src/supervisor/policy.ts || fail "durable project policy store missing"
grep -Fq "unknown', 'workshop', 'client', 'knowledge" src/supervisor/policy.ts || fail "project classes missing"
grep -Fq "observe', 'assist', 'build', 'unattended" src/supervisor/policy.ts || fail "trust levels missing"
grep -Fq "maxWorkers: 3" src/supervisor/policy.ts || fail "assist worker ceiling missing"
grep -Fq "maxWorkers: 6" src/supervisor/policy.ts || fail "build worker ceiling missing"
grep -Fq "maxWorkers: 8" src/supervisor/policy.ts || fail "unattended worker ceiling missing"
grep -Fq "passing independent grade is required" src/supervisor/policy.ts || fail "trust promotion grade gate missing"
grep -Fq "major goal report" src/supervisor/runtime.ts || fail "coordinator cannot durably report goal state"
grep -Fq "Skillify" src/supervisor/runtime.ts || fail "coordinator is not skill-first"
grep -Fq "Tools-as-Code" src/supervisor/runtime.ts || fail "coordinator lacks Tools-as-Code guidance"
for provider in claude codex cursor antigravity; do
  grep -Fq "case '$provider'" src/supervisor/worker.ts || fail "live worker adapter missing: $provider"
done

# Every supervisor process launch must flow through the Major successor gateway.
if grep -R -F -n "node:child_process" src/supervisor; then
  fail "supervisor bypasses the execution gateway"
fi
grep -Fq "executeMajorCommand" src/supervisor/worker.ts || fail "workers are not using the successor gateway"
grep -Fq "runGatewayCommand" src/supervisor/cli.ts || fail "worktree setup is not using the successor gateway"
grep -Fq "execution-policy.jsonl" src/security/major-gateway.ts || fail "successor gateway lacks execution audit"
grep -Fq "globalStopRequested" src/supervisor/worker.ts || fail "active workers ignore global kill switch"

# Pilot deployment: Major is globally present, but no global autonomous daemon/swarm is installed.
grep -Fq "SessionStart" scripts/install-major-runtime.sh || fail "Claude automatic session attach hook missing"
grep -Fq "startup|resume|clear|compact" scripts/install-major-runtime.sh || fail "Claude attach hook does not cover session lifecycle"
grep -Fq "do NOT auto-start a login daemon" scripts/install-major-runtime.sh || fail "pilot installer must avoid login autonomy"
grep -Fq "Ruflo is NOT attached globally" scripts/install-major-runtime.sh || fail "pilot installer must avoid global Ruflo blast radius"
if grep -Fq "launchctl bootstrap" scripts/install-major-runtime.sh; then
  fail "pilot installer must not start a login daemon"
fi
if grep -Fq "claude mcp add ruflo" scripts/install-major-runtime.sh || grep -Fq "codex mcp add ruflo" scripts/install-major-runtime.sh; then
  fail "Ruflo must not be globally attached during pilot"
fi
grep -Fq "major stop" scripts/install-major-runtime.sh || fail "installer must surface kill switch"

# Codex is implementation capacity by default; the v1 review-only reserve must not return.
grep -Fq "preserveCodexForReview ?? false" src/routing/router.ts || fail "Codex implementation routing default missing"
if grep -Fq "never consumes codex for implementation work" tests/router.test.ts; then
  fail "legacy Codex review-only test returned"
fi

# Old runtime remains a temporary migration source until the new supervisor proves itself on JSS.
grep -Fiq "migration is incomplete" docs/architecture.md || fail "runtime migration caveat missing"
grep -Fq "DELETE after successor verification" docs/migrations/major-v2-legacy-receipt.md || fail "legacy deletion gate missing"

echo "Major validation passed."
