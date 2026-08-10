#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "MAJOR STABILITY VALIDATION FAILED: $*" >&2; exit 1; }

[ -f guidance/stability-invariants.md ] || fail "stability invariants missing"
grep -Fq '"stability-invariants"' guidance/instructions.registry.json || fail "stability guidance not registered"

for skill in \
  project-context-integrity \
  mcp-integration-ops \
  major-self-maintenance \
  website-design-qa \
  responsive-motion-systems; do
  [ -f "skills/internal/$skill/SKILL.md" ] || fail "required stability skill missing: $skill"
  grep -Fq "\"id\":\"$skill\"" guidance/skills.registry.json || fail "stability skill not registered: $skill"
  [ -f "evals/skill-resolver/$skill.json" ] || fail "resolver eval missing: $skill"
done

grep -Fq 'projectContextIntegrityRequired' guidance/skills.registry.json || fail "project context policy flag missing"
grep -Fq 'majorMainMustStayGreen' guidance/skills.registry.json || fail "Major main-green policy flag missing"

grep -Fq 'LEARNINGS.md' src/supervisor/runtime.ts || fail "coordinator does not preload project learnings"
grep -Fq 'listLearningCandidates' src/supervisor/runtime.ts || fail "coordinator does not preload Major learning candidates"
grep -Fq 'project-context-integrity' src/supervisor/runtime.ts || fail "coordinator lacks project context integrity contract"
grep -Fq 'mcp-integration-ops' src/supervisor/runtime.ts || fail "coordinator lacks MCP integration truth-state contract"
grep -Fq 'website-design-qa' src/supervisor/runtime.ts || fail "coordinator lacks website QA routing"

[ -f src/context/session-context.ts ] || fail "enriched session context loader missing"
grep -Fq 'runSessionContextCli' src/entry.ts || fail "session context loader is not wired into Major entrypoint"
grep -Fq 'DURABLE PROJECT LEARNINGS' src/context/session-context.ts || fail "session attach does not preload project learnings"
grep -Fq 'ACTIVE MAJOR LEARNING CANDIDATES' src/context/session-context.ts || fail "session attach does not preload learning candidates"
grep -Fq 'website-design-qa' src/context/session-context.ts || fail "session attach lacks website QA routing reminder"
grep -Fq 'mcp-integration-ops' src/context/session-context.ts || fail "session attach lacks MCP integration routing reminder"

grep -Fq 'runProjectContextCli' src/entry.ts || fail "project context CLI is not wired into Major entrypoint"
grep -Fq 'PROJECT CONTEXT: REROUTE' src/context/project-integrity.ts || fail "wrong-repo reroute signal missing"
grep -Fq 'major project guard' skills/internal/project-context-integrity/SKILL.md || fail "project guard command missing from skill"

grep -Fq 'GLOBAL_SKILLS_DEST' scripts/install-major-global-rules.sh || fail "global internal skill sync missing"
grep -Fq 'STABILITY_SRC' scripts/install-major-global-rules.sh || fail "stability invariants not installed globally"
grep -Fq 'A correct change in the wrong repo is a failed task' templates/project/major-core.md || fail "project template lacks wrong-repo invariant"
grep -Fq 'major learn list --project current' templates/project/major-core.md || fail "project template lacks learning preload"
grep -Fq 'mcp-integration-ops' templates/project/major-core.md || fail "project template lacks MCP integration routing"
grep -Fq 'website-design-qa' templates/project/major-core.md || fail "project template lacks website QA routing"

grep -Fq 'At two occurrences' skills/internal/learning-capture/SKILL.md || fail "learning recurrence promotion threshold missing"
grep -Fq 'Major `main` must stay green' skills/internal/major-self-maintenance/SKILL.md || fail "Major self-maintenance green-main rule missing"

echo "Major stability validation passed."
