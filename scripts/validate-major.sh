#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "MAJOR VALIDATION FAILED: $*" >&2; exit 1; }

for script in scripts/*.sh; do bash -n "$script" || fail "shell syntax: $script"; done
PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/major-validation-pycache" \
  python3 -m py_compile scripts/*.py || fail "Python helper syntax"
python3 - <<'PY'
import json
from pathlib import Path
for p in Path('.').rglob('*.json'):
    try:
        json.loads(p.read_text())
    except Exception as e:
        raise SystemExit(f"invalid JSON: {p}: {e}")
PY

node scripts/validate-skills.mjs || fail "skills, YAML frontmatter, resolver fixtures, or reusable asset metadata"

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
    'communication-style', 'tool-routing-and-source-ingestion',
    'mvp-speed-and-prioritisation', 'autonomy-and-progress',
    'legacy-cleanup', 'security-and-permissions', 'ui-patterns-and-reuse',
    'task-scope', 'model-routing', 'human-approval', 'roadmap-sync'
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
for required_skill in [
    'source-ingestion', 'knowledge-work', 'skillify', 'tools-as-code',
    'learning-capture', 'remote-first-web-development', 'human-blocker-orchestration',
    'dev-server-management', 'prior-art-discovery'
]:
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
    'captureExplicitCorrections',
    'priorArtBeforeNewInfrastructure',
]:
    if policy.get(key) is not True:
        raise SystemExit(f"required skill policy not enabled: {key}")
for fixture in [
    'evals/skill-resolver/skill-resolver.json',
    'evals/skill-resolver/skillify.json',
    'evals/skill-resolver/tools-as-code.json',
    'evals/skill-resolver/learning-capture.json',
    'evals/skill-resolver/remote-first-web-development.json',
    'evals/skill-resolver/dev-server-management.json',
    'evals/skill-resolver/prior-art-discovery.json',
]:
    if not Path(fixture).is_file():
        raise SystemExit(f"resolver eval missing: {fixture}")
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
grep -Fq "Make it work, make it useful, then improve or harden it" guidance/global-worker-rules.md || fail "work-use-improve doctrine missing"
grep -Fq "Maximise useful concurrency" guidance/global-worker-rules.md || fail "useful concurrency doctrine missing"
grep -Fq "Serialize only actual conflicts" guidance/global-worker-rules.md || fail "conflict-only serialization doctrine missing"
grep -Fq "current physical/runtime capacity" guidance/global-worker-rules.md || fail "physical capacity qualification missing"
grep -Fq "Critical-path dependencies" templates/project/GOAL_STATE.md || fail "shared critical-path state template missing"
grep -Fq "Ownership and interfaces" templates/project/GOAL_STATE.md || fail "shared ownership state template missing"
grep -Fq "Evidence stages" templates/project/QUALITY.md || fail "FAST acceptance release template missing"
grep -Fq "operating-principle enforcement" docs/prior-art-decisions.md || fail "operating principle prior-art record missing"
grep -Fq "OPERATING PRINCIPLE:" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "native DSH operating principle missing"
grep -Fq "serialize only real write, interface, ordering or scarce-resource conflicts" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "native DSH conflict policy missing"
grep -Fq "Git history is the audit archive" guidance/instruction-precedence.md || fail "clean supersession doctrine missing"
grep -Fiq "continue until" guidance/autonomy-and-progress.md || fail "continue-until autonomy doctrine missing"
grep -Fq "ASD-STE100-inspired" guidance/communication-style.md || fail "communication standard missing"
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
grep -Fq "MAJOR SHADOW PLAN" guidance/global-worker-rules.md || fail "observe-first shadow plan rule missing"
grep -Fq "Three consecutive passing shadow grades" guidance/global-worker-rules.md || fail "shadow promotion threshold missing"
grep -Fq "Tools as Code" guidance/global-worker-rules.md || fail "Tools-as-Code rule missing"
grep -Fq "skillify" guidance/global-worker-rules.md || fail "skillify rule missing"
grep -Fq "Prior art before new infrastructure" guidance/global-worker-rules.md || fail "prior-art infrastructure rule missing"
grep -Eq '"id"[[:space:]]*:[[:space:]]*"prior-art-discovery"' guidance/skills.registry.json || fail "prior-art-discovery skill not registered"
[ -f skills/internal/prior-art-discovery/SKILL.md ] || fail "prior-art-discovery skill missing"
[ -f docs/prior-art-decisions.md ] || fail "prior-art decision log missing"
grep -Fq "Prior art before new infrastructure" guidance/stability-invariants.md || fail "prior-art stability invariant missing"
grep -Fq "major learn capture" guidance/global-worker-rules.md || fail "explicit correction capture rule missing"
grep -Fq "remote-first-web-development" guidance/global-worker-rules.md || fail "remote-first web rule missing"
grep -Fq "major web preflight" guidance/global-worker-rules.md || fail "remote browser-target guard missing"
grep -Fq "human-blocker-orchestration" guidance/global-worker-rules.md || fail "human blocker rule missing"
grep -Fq "notify-human-blocker.sh" skills/internal/human-blocker-orchestration/SKILL.md || fail "human notification command missing"
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

# Thin-kernel supervisor runtime and machine-global coordination state.
[ -f src/entry.ts ] || fail "global Major supervisor entry missing"
[ -f src/supervisor/state.ts ] || fail "durable supervisor state missing"
[ -f src/supervisor/policy.ts ] || fail "project trust policy missing"
[ -f src/supervisor/runtime.ts ] || fail "supervisor goal loop missing"
[ -f src/supervisor/worker.ts ] || fail "multi-provider worker runtime missing"
[ -f src/supervisor/cli.ts ] || fail "supervisor CLI missing"
[ -f src/security/major-gateway.ts ] || fail "Major successor execution gateway missing"
[ -f src/dev/ports.ts ] || fail "dev-port allocator missing"
[ -f src/learning/candidates.ts ] || fail "learning candidate queue missing"
[ -f src/learning/lifecycle-cli.ts ] || fail "canonical learning lifecycle CLI missing"
[ -f scripts/install-major-runtime.sh ] || fail "runtime installer missing"

grep -Fq '"major": "./dist/entry.js"' package.json || fail "package bin must enter the supervisor runtime"
grep -Fq "supervisor-state.json" src/supervisor/state.ts || fail "durable cross-session goal state missing"
grep -Fq "project-policies.json" src/supervisor/policy.ts || fail "durable project policy store missing"
grep -Fq "dev-ports.json" src/dev/ports.ts || fail "durable dev-port registry missing"
grep -Fq "function projectStorePath" src/learning/candidates.ts || fail "project-local learning store missing"
grep -Fq "function globalStorePath" src/learning/candidates.ts || fail "sanitized global learning store missing"
grep -Fq "command === 'dev'" src/supervisor/cli.ts || fail "dev-port CLI path missing"
grep -Fq "args[1] === 'capture'" src/learning/lifecycle-cli.ts || fail "learning-capture CLI path missing"
grep -Fq "unknown', 'workshop', 'client', 'knowledge" src/supervisor/policy.ts || fail "project classes missing"
grep -Fq "observe', 'assist', 'build', 'unattended" src/supervisor/policy.ts || fail "trust levels missing"
grep -Fq "maxWorkers: 1" src/supervisor/policy.ts || fail "truthful project worker ceiling missing"
grep -Fq "maxRunMinutes: 30" src/supervisor/policy.ts || fail "assist wall-clock ceiling missing"
grep -Fq "workers: 1" src/supervisor/resources.ts || fail "configured DSH worker ceiling missing"
grep -Fq "GLOBAL_RESOURCE_LIMITS" src/supervisor/resources.ts || fail "global resource guard missing"
grep -Fq "maxSubagentDepth: 1" src/supervisor/resources.ts || fail "subagent depth cap missing"
grep -Fq "three consecutive independently graded shadow passes" src/supervisor/policy.ts || fail "observe-to-assist shadow gate missing"
grep -Fq "recordShadowGrade" src/supervisor/cli.ts || fail "shadow grade CLI path missing"
grep -Fq 'MAJOR_RESULT:' src/supervisor/runtime.ts || fail "coordinator has no parent-owned result channel"
if grep -Fq "major goal report" src/supervisor/runtime.ts; then
  fail "sandboxed coordinator must not mutate Major global state directly"
fi
grep -Fq "Skillify" src/supervisor/runtime.ts || fail "coordinator is not skill-first"
grep -Fq "Tools-as-Code" src/supervisor/runtime.ts || fail "coordinator lacks Tools-as-Code guidance"
for provider in claude codex cursor antigravity; do
  grep -Fq "case '$provider'" src/providers/commands.ts || fail "live worker adapter missing: $provider"
done
grep -Fq 'providerArgs' src/supervisor/worker.ts || fail "worker bypasses shared provider command builder"

if grep -R -F -n "node:child_process" src/supervisor; then
  fail "supervisor bypasses the execution gateway"
fi
grep -Fq "executeMajorCommand" src/supervisor/worker.ts || fail "workers are not using the successor gateway"
grep -Fq "runGatewayCommand" src/supervisor/cli.ts || fail "worktree setup is not using the successor gateway"
grep -Fq "execution-policy.jsonl" src/security/major-gateway.ts || fail "successor gateway lacks execution audit"
grep -Fq "globalStopRequested" src/supervisor/worker.ts || fail "active workers ignore global kill switch"

# Pilot deployment: Major is globally present, but no global autonomous daemon/swarm is installed.
grep -Fq "SessionStart" scripts/stage-major-user-state.py || fail "Claude automatic session attach hook missing"
grep -Fq "startup|resume|clear|compact" scripts/stage-major-user-state.py || fail "Claude attach hook does not cover session lifecycle"
grep -Fq "no auto-start daemon" scripts/install-major-runtime.sh || fail "pilot installer must avoid login autonomy"
grep -Fq "Ruflo is NOT attached globally" scripts/install-major-runtime.sh || fail "pilot installer must avoid global Ruflo blast radius"
grep -Fq "trust observe" scripts/install-major-runtime.sh || fail "optional observe pilot path must remain available"
python3 - <<'PY'
import re
from pathlib import Path

lines = Path('scripts/install-major-runtime.sh').read_text().splitlines()
commands = [
    line.strip()
    for line in lines
    if re.match(r'^\s*(?:if\s+!\s+)?launchctl\s+bootstrap\b', line)
]
expected = ['if ! launchctl bootstrap "gui/$UID" "$LEGACY_PLIST" >/dev/null 2>&1; then']
if commands != expected:
    raise SystemExit(
        'MAJOR VALIDATION FAILED: pilot installer contains an unexpected launchctl bootstrap command: '
        + repr(commands)
    )
PY
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
grep -Fq "Migration cleanup is incomplete" docs/architecture.md || fail "runtime migration caveat missing"
grep -Fq "DELETE after successor verification" docs/migrations/major-v2-legacy-receipt.md || fail "legacy deletion gate missing"

[ -f src/resources/retention.ts ] || fail "resource retention policy missing"
[ -f src/resources/inventory.ts ] || fail "resource inventory classifier missing"
[ -f src/resources/usage.ts ] || fail "physical usage measurement missing"
[ -f src/resources/preflight.ts ] || fail "disk-pressure preflight missing"
grep -Fq "ROLLBACK_GENERATIONS" src/resources/retention.ts || fail "rollback generation bound missing from retention policy"
grep -Fq "command('cleanup')" src/cli/index.ts || fail "major cleanup command missing"
grep -Fq "estimated up to" src/resources/cleanup.ts || fail "cleanup dry-run upper-bound label missing"
grep -Fq "df-delta" src/resources/cleanup.ts || fail "cleanup apply must report measured df delta"
grep -Fq "major_clone_or_copy" scripts/build-major-runtime-snapshot.sh || fail "release snapshot clonefile helper unused"
grep -Fq "cp -c" scripts/major-clone-tree.sh || fail "clonefile copy helper missing"
grep -Fq "Resource hygiene" docs/architecture.md || fail "resource hygiene architecture section missing"
grep -Fq "designed before creation" docs/architecture.md || fail "resource-efficiency lifecycle rule missing"

[ -f src/harness/pin.ts ] || fail "DeepSeek Harness pin missing"
[ -f src/harness/cli.ts ] || fail "major harness CLI missing"
[ -f distribution/deepseek-harness/pin.json ] || fail "DeepSeek Harness pin artifact missing"
[ -f docs/migrations/deepseek-harness-strangler.md ] || fail "DeepSeek Harness strangler receipt missing"
grep -Fq "CURRENT_HARNESS_MIGRATION_PHASE" src/harness/composition.ts || fail "harness migration phase missing"
grep -Fq "export async function runHarnessCli" src/harness/cli.ts || fail "harness CLI export missing"
grep -Fq "runHarnessCli" src/entry.ts || fail "harness CLI not wired through entry"
grep -Fq "return new LimaBackend" src/security/major-gateway.ts || fail "the explicit legacy Lima compatibility backend must remain available"
grep -Fq "ADOPT DeepSeek Harness" docs/prior-art-decisions.md || fail "DeepSeek Harness prior-art decision missing"
grep -Fq "Status: **cutover**" docs/migrations/deepseek-harness-strangler.md || fail "DeepSeek Harness cutover receipt missing"
grep -Fq '"declaredTag": "dsh-v0.1.0-rc.8"' distribution/deepseek-harness/pin.json || fail "DeepSeek Harness release tag is not attested"
grep -Fq '"attestedCommit": "141eb6fef83422698aef7a981029e843e8161534"' distribution/deepseek-harness/pin.json || fail "DeepSeek Harness commit is not attested"
grep -Fq '"@deepseek-ai/dsh": "sha512-' distribution/deepseek-harness/pin.json || fail "DeepSeek Harness npm integrity is not attested"
grep -Fq '"bundle": {' distribution/deepseek-harness/bundles/major-kernel/package.json || fail "DeepSeek Harness bundle manifest has the wrong upstream shape"
grep -Fq '"patch": "./cordis.patch.yml"' distribution/deepseek-harness/bundles/major-kernel/package.json || fail "DeepSeek Harness bundle patch declaration missing"
grep -Fq '"main": "./index.js"' distribution/deepseek-harness/bundles/major-kernel/package.json || fail "DeepSeek Harness Major kernel entrypoint missing"
grep -Fq '"./client": "./client.js"' distribution/deepseek-harness/bundles/major-kernel/package.json || fail "DeepSeek Harness Major client entrypoint missing"
grep -Fq '"./package.json": "./package.json"' distribution/deepseek-harness/bundles/major-kernel/package.json || fail "DeepSeek Harness Major package metadata entrypoint missing"
[ -f distribution/deepseek-harness/bundles/major-kernel/client.js ] || fail "DeepSeek Harness Major client projection missing"
[ -f distribution/deepseek-harness/bundles/major-kernel/route-context.js ] || fail "DeepSeek Harness routed execution context missing"
[ ! -e distribution/deepseek-harness/bundles/major-kernel/client.css ] || fail "DeepSeek Harness Major client must reuse upstream command-input styles"
[ ! -e distribution/deepseek-harness/bundles/major-kernel/command-input.js ] || fail "DeepSeek Harness Major client must be one self-contained lazy-CJS factory"
grep -Fq "window.__ModuleLoader__.load({" distribution/deepseek-harness/bundles/major-kernel/client.js || fail "DeepSeek Harness Major client is not a lazy-CJS module factory"
grep -Fq "id: '@major/dsh-kernel'" distribution/deepseek-harness/bundles/major-kernel/client.js || fail "DeepSeek Harness Major client factory id missing"
grep -Fq "event.data.name === 'major'" distribution/deepseek-harness/bundles/major-kernel/client.js || fail "DeepSeek Harness /major replay projection missing"
grep -Fq "kind: 'command-input'" distribution/deepseek-harness/bundles/major-kernel/client.js || fail "DeepSeek Harness /major projection does not reuse the upstream command-input renderer"
grep -Fq "conversationEvents.register(majorCommandInputDefinition)" distribution/deepseek-harness/bundles/major-kernel/client.js || fail "DeepSeek Harness /major replay projection not registered"
grep -Fq 'cp -f "$KERNEL_SOURCE/client.js" "$KERNEL_DEST/client.js"' scripts/install-deepseek-harness-pin.sh || fail "DeepSeek Harness installer omits the Major client entrypoint"
grep -Fq 'cp -f "$KERNEL_SOURCE/route-context.js" "$KERNEL_DEST/route-context.js"' scripts/install-deepseek-harness-pin.sh || fail "DeepSeek Harness installer omits routed execution context"
grep -Fq "withRoutedExecutionContext" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "DeepSeek Harness native routes are not async-context isolated"
if grep -Fq "process.env.MAJOR_DSH_ROUTE_" distribution/deepseek-harness/bundles/major-kernel/lima-subprocess.js; then fail "DeepSeek Harness Lima route metadata must not use global process environment"; fi
grep -Fq "resolveSupervisedWorkshopAuthority(cwd)" src/harness/cli.ts || fail "DeepSeek Harness Lima bridge does not resolve live mutation authority"
grep -Fq "assertSupervisedWorkshopAuthority(request.executionAuthority, request.cwd)" src/execution/lima-backend.ts || fail "DeepSeek Harness Lima bridge does not revalidate mutation authority"
grep -Fq "routeGoalExecution(goal, { eligibleHosts: ['codex'] })" src/supervisor/cli.ts || fail "DeepSeek Harness route must exclude hosts without a live mutation adapter"
grep -Fq "name: '@major/dsh-kernel'" distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml || fail "DeepSeek Harness Major kernel is not mounted"
grep -Fq "provider: major" distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml || fail "DeepSeek Harness Major composer provider is not the default model"
grep -Fq "model: composer" distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml || fail "DeepSeek Harness Major composer model is not the default model"
if grep -Fq "id: agent-presets" distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml; then fail "DeepSeek Harness shared kernel must not patch the web-only agent preset entry"; fi
grep -Fq "id: agent-presets" distribution/deepseek-harness/profiles/major-workstation-web/cordis.patch.yml || fail "DeepSeek Harness web profile does not select the Major agent preset"
grep -Fq "default: major" distribution/deepseek-harness/profiles/major-workstation-web/cordis.patch.yml || fail "DeepSeek Harness Major agent preset is not the web default"
[ -f distribution/deepseek-harness/agent-presets/major/agent.cordis.yml ] || fail "DeepSeek Harness Major system preset composition missing"
[ -f distribution/deepseek-harness/agent-presets/major/preset.yml ] || fail "DeepSeek Harness Major system preset metadata missing"
grep -Fq 'stage_major_system_preset' scripts/install-deepseek-harness-pin.sh || fail "DeepSeek Harness installer omits the Major system preset"
grep -Fq 'served __DSH_BOOT__ graph omits @major/dsh-kernel' scripts/start-major-workstation.sh || fail "Major workstation does not verify the served kernel boot graph"
grep -Fq "name: 'major'" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "DeepSeek Harness Major provider missing"
grep -Fq "description: 'run one Major increment" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "DeepSeek Harness Major command missing"
grep -Fq '"@major/dsh-kernel": "file:../../bundles/major-kernel"' distribution/deepseek-harness/profiles/major-workstation-web/package.json || fail "DeepSeek Harness web profile cannot resolve the Major kernel bundle"
grep -Fq '"@major/dsh-kernel": "file:../../bundles/major-kernel"' distribution/deepseek-harness/profiles/major-workstation-headless/package.json || fail "DeepSeek Harness headless profile cannot resolve the Major kernel bundle"
grep -Fq "DeepSeek Harness distribution" docs/architecture.md || fail "architecture missing DeepSeek Harness distribution"
if grep -Fq '"@deepseek-ai/' package.json; then
  fail "DeepSeek Harness must stay pinned, not an unattested package.json dependency"
fi
[ -f scripts/install-deepseek-harness-pin.sh ] || fail "DeepSeek Harness pin installer missing"
[ -f src/harness/install-plan.ts ] || fail "DeepSeek Harness install plan missing"
[ -f distribution/deepseek-harness/profiles/major-workstation-web/pnpm-workspace.yaml ] || fail "DeepSeek Harness web profile pnpm layout missing"
[ -f distribution/deepseek-harness/profiles/major-workstation-headless/pnpm-workspace.yaml ] || fail "DeepSeek Harness headless profile pnpm layout missing"
grep -Fq "buildHarnessInstallPlan" src/harness/cli.ts || fail "harness install-plan CLI missing"
grep -Fq "attestedCommit is required before install" scripts/install-deepseek-harness-pin.sh || fail "pin installer must refuse unattested commits"
grep -Fq "integrity mismatch" scripts/install-deepseek-harness-pin.sh || fail "pin installer must verify npm integrity"
grep -Fq '"defaultRuntime": "dsh-local"' scripts/install-deepseek-harness-pin.sh || fail "pin installer must record local DSH as the default runtime"
grep -Fq -- "--dump-config" scripts/install-deepseek-harness-pin.sh || fail "pin installer must verify composed profiles"
grep -Fq "link_shared_runtime" scripts/install-deepseek-harness-pin.sh || fail "pin installer must share one DSH dependency closure"
grep -Fq "disk preflight blocked" scripts/install-deepseek-harness-pin.sh || fail "pin installer must refuse DSH/Lima install on a full disk"
grep -Fq "major-app/dsh" distribution/deepseek-harness/bundles/major-kernel/index.js || fail "Major DSH kernel must record the native app interaction origin"
if grep -Eq "'--host', '(claude|codex|cursor|antigravity)'" distribution/deepseek-harness/bundles/major-kernel/index.js; then
  fail "Major DSH kernel must not hard-code a provider host"
fi
[ -f scripts/validate-dsh-field.sh ] || fail "DeepSeek Harness field validator missing"
grep -Fq '"validate:dsh"' package.json || fail "package.json must expose validate:dsh"
grep -Fq "externalSessionHostEnv" scripts/install-deepseek-harness-pin.sh || fail "install record must distinguish external host identity from native app origin"
[ -f scripts/start-major-workstation.sh ] || fail "Major workstation launcher missing"
[ -f scripts/stage-major-workstation-app.sh ] || fail "Major.app stager missing"
[ -f distribution/deepseek-harness/macos/Major.app/Contents/Info.plist ] || fail "Major.app Info.plist missing"
grep -Fq "stage_workstation_app" scripts/install-deepseek-harness-pin.sh || fail "pin installer must stage the reversible Major.app launcher"
grep -Fq -- '--app=' scripts/start-major-workstation.sh || fail "workstation launcher must open Chrome app-mode"
grep -Fq 'LISTEN_HOST="127.0.0.1"' scripts/start-major-workstation.sh || fail "workstation launcher must bind loopback only"
grep -Fq "WRAP the existing \`major-workstation-web\` profile" docs/prior-art-decisions.md || fail "Mac workstation prior-art decision missing"
grep -Fq "Codex guest mutation requires active supervised Workshop authority" src/security/guest-mutation.ts || fail "Codex guest mutation must require active Supervised Workshop"
grep -Fq "assertGuestMutationPolicy" src/security/gateway.ts || fail "execution gateway must enforce guest mutation policy"
grep -Fq "assertGuestMutationPolicy" src/execution/lima-backend.ts || fail "Lima copy-back must enforce guest mutation policy"
grep -Fq "workspaceMutatedFromDiffExit(diff.code, diff.stderr)" src/execution/lima-backend.ts || fail "Lima must classify its returned workspace delta"
grep -Fq "if (code === 0) return false" src/execution/lima-backend.ts || fail "Lima diff exit 0 must mean no returned delta"
grep -Fq "if (code === 1) return true" src/execution/lima-backend.ts || fail "Lima diff exit 1 must mean a returned delta"
grep -Fq "codexMutationClaimRefusal(outcome, report)" src/supervisor/runtime.ts || fail "supervisor must adjudicate Codex mutation claims from backend evidence"

echo "Major validation passed."
