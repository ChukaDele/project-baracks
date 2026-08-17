#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "MAJOR STABILITY VALIDATION FAILED: $*" >&2; exit 1; }

[ -f guidance/stability-invariants.md ] || fail "stability invariants missing"
grep -Fq '"stability-invariants"' guidance/instructions.registry.json || fail "stability guidance not registered"

for skill in \
  project-context-integrity \
  workspace-lifecycle-management \
  mcp-integration-ops \
  major-self-maintenance \
  design-direction-and-taste \
  website-design-qa \
  responsive-motion-systems; do
  [ -f "skills/internal/$skill/SKILL.md" ] || fail "required stability skill missing: $skill"
  grep -Fq "\"id\":\"$skill\"" guidance/skills.registry.json || fail "stability skill not registered: $skill"
  [ -f "evals/skill-resolver/$skill.json" ] || fail "resolver eval missing: $skill"
done

grep -Fq 'projectContextIntegrityRequired' guidance/skills.registry.json || fail "project context policy flag missing"
grep -Fq 'majorMainMustStayGreen' guidance/skills.registry.json || fail "Major main-green policy flag missing"
grep -Fq 'singleCanonicalDesignDirectionLayer' guidance/skills.registry.json || fail "single canonical design direction policy missing"
grep -Fq 'workspaceLifecyclePolicy' guidance/skills.registry.json || fail "workspace lifecycle policy flag missing"
grep -Fq 'priorArtBeforeNewInfrastructure' guidance/skills.registry.json || fail "prior-art infrastructure policy flag missing"

grep -Fq "Prior art before new infrastructure" guidance/global-worker-rules.md || fail "prior-art infrastructure rule missing"
grep -Fq '"id":"prior-art-discovery"' guidance/skills.registry.json || fail "prior-art-discovery skill not registered"
[ -f skills/internal/prior-art-discovery/SKILL.md ] || fail "prior-art-discovery skill missing"
[ -f docs/prior-art-decisions.md ] || fail "prior-art decision log missing"
grep -Fq "Prior art before new infrastructure" guidance/stability-invariants.md || fail "prior-art stability invariant missing"

grep -Fq 'smallest correct modular implementation' guidance/global-worker-rules.md || fail "global code-simplicity invariant missing"
grep -Fq 'simple-modular-code' guidance/global-worker-rules.md || fail "global rules do not route modular-code guidance"
grep -Fq 'Do not describe intended state as observed state' skills/internal/major-self-maintenance/SKILL.md || fail "self-maintenance lacks operational-truth rule"
grep -Fq 'live PR state' skills/internal/major-self-maintenance/SKILL.md || fail "self-maintenance does not verify CI-triggering state before claims"

[ -f memory/verified/design-direction-taste-synthesis.md ] || fail "Impeccable/Taste synthesis memory missing"
grep -Fq '2ab054d1f400c5ec085133352232ffc2617f0d54' memory/verified/design-direction-taste-synthesis.md || fail "Impeccable source commit not pinned in synthesis"
grep -Fq 'e988add20dab0fa97d7a76781c48961c8184288e' memory/verified/design-direction-taste-synthesis.md || fail "Taste source commit not pinned in synthesis"
grep -Fq 'not installed wholesale' memory/verified/design-direction-taste-synthesis.md || fail "duplicate design-system rejection missing"

[ -f memory/verified/developer-workspace-lifecycle.md ] || fail "developer workspace lifecycle memory missing"
grep -Fq 'Mac = active workspace' memory/verified/developer-workspace-lifecycle.md || fail "active-workspace doctrine missing"
grep -Fq 'GitHub = canonical source code' memory/verified/developer-workspace-lifecycle.md || fail "canonical source doctrine missing"
grep -Fq 'HOT / WARM / COLD' memory/verified/developer-workspace-lifecycle.md || fail "HOT/WARM/COLD lifecycle missing"
grep -Fq 'Never delete a local clone' memory/verified/developer-workspace-lifecycle.md || fail "safe parking invariant missing"
grep -Fq '60–80 GB free' memory/verified/developer-workspace-lifecycle.md || fail "machine disk target missing"

grep -Fq 'LEARNINGS.md' src/supervisor/runtime.ts || fail "coordinator does not preload project learnings"
grep -Fq 'listLearningCandidates' src/supervisor/runtime.ts || fail "coordinator does not preload Major learning candidates"
grep -Fq 'project-context-integrity' src/supervisor/runtime.ts || fail "coordinator lacks project context integrity contract"
grep -Fq 'mcp-integration-ops' src/supervisor/runtime.ts || fail "coordinator lacks MCP integration truth-state contract"
grep -Fq 'design-direction-and-taste' src/supervisor/runtime.ts || fail "coordinator lacks canonical design direction routing"
grep -Fq 'website-design-qa' src/supervisor/runtime.ts || fail "coordinator lacks website QA routing"

[ -f src/context/session-context.ts ] || fail "enriched session context loader missing"
grep -Fq 'runSessionContextCli' src/entry.ts || fail "session context loader is not wired into Major entrypoint"
grep -Fq 'runLearningLifecycleCli' src/entry.ts || fail "learning lifecycle CLI is not wired into Major entrypoint"
grep -Fq 'DURABLE PROJECT LEARNINGS' src/context/session-context.ts || fail "session attach does not preload project learnings"
grep -Fq 'ACTIVE MAJOR LEARNINGS' src/context/session-context.ts || fail "session attach does not preload active and promoted learnings"
grep -Fq 'REVIEW-DUE' src/context/session-context.ts || fail "session attach does not flag recurring learning for promotion review"
grep -Fq 'design-direction-and-taste' src/context/session-context.ts || fail "session attach lacks canonical design direction routing reminder"
grep -Fq 'website-design-qa' src/context/session-context.ts || fail "session attach lacks website QA routing reminder"
grep -Fq 'mcp-integration-ops' src/context/session-context.ts || fail "session attach lacks MCP integration routing reminder"

if grep -Fq "command === 'learn'" src/supervisor/cli.ts; then
  fail "duplicate learning CLI path remains in supervisor CLI"
fi
grep -Fq "args[1] === 'capture'" src/learning/lifecycle-cli.ts || fail "learning capture is not exposed through canonical learning CLI"
grep -Fq "args[1] === 'list'" src/learning/lifecycle-cli.ts || fail "learning list is not exposed through canonical learning CLI"
grep -Fq "args[1] === 'promote'" src/learning/lifecycle-cli.ts || fail "learning promotion is not exposed through canonical learning CLI"
grep -Fq "args[1] === 'dismiss'" src/learning/lifecycle-cli.ts || fail "learning dismissal is not exposed through canonical learning CLI"

grep -Fq 'runProjectContextCli' src/entry.ts || fail "project context CLI is not wired into Major entrypoint"
grep -Fq 'PROJECT CONTEXT: REROUTE' src/context/project-integrity.ts || fail "wrong-repo reroute signal missing"
grep -Fq 'major project guard' skills/internal/project-context-integrity/SKILL.md || fail "project guard command missing from skill"
grep -Fq 'safe parking protocol' -i skills/internal/workspace-lifecycle-management/SKILL.md || fail "workspace lifecycle safe parking protocol missing"
grep -Fq 'commondir' src/supervisor/state.ts || fail "project resolution is not Git-worktree aware"
grep -Fq 'sessionMatches' src/supervisor/state.ts || fail "project resolution ignores prior attached sessions"

grep -Fq 'GLOBAL_SKILLS_DEST' scripts/install-major-global-rules.sh || fail "global internal skill sync missing"
grep -Fq 'STABILITY_SRC' scripts/install-major-global-rules.sh || fail "stability invariants not installed globally"
grep -Fq 'installed-global-rules.json' scripts/install-major-global-rules.sh || fail "global rules install provenance record missing"
grep -Fq -- '--global-rules-record "$RULES_RECORD_TMP"' scripts/install-major-runtime.sh || fail "runtime installer does not refresh global rules provenance"
grep -Fq 'A correct change in the wrong repo is a failed task' templates/project/major-core.md || fail "project template lacks wrong-repo invariant"
grep -Fq 'major learn list --project current' templates/project/major-core.md || fail "project template lacks learning preload"
grep -Fq 'mcp-integration-ops' templates/project/major-core.md || fail "project template lacks MCP integration routing"
grep -Fq 'website-design-qa' templates/project/major-core.md || fail "project template lacks website QA routing"
grep -Fq 'workspace-lifecycle-management' skills/internal/project-start/SKILL.md || fail "project-start does not route lifecycle decisions"

grep -Fq 'At two occurrences' skills/internal/learning-capture/SKILL.md || fail "learning recurrence promotion threshold missing"
grep -Fq -- '--key' skills/internal/learning-capture/SKILL.md || fail "learning capture does not teach stable recurrence keys"
grep -Fq 'promoteLearning' src/learning/candidates.ts || fail "learning store has no promotion lifecycle"
grep -Fq 'dismissLearning' src/learning/candidates.ts || fail "learning store has no dismissal lifecycle"
grep -Fq 'learningReviewDue' src/learning/candidates.ts || fail "learning store cannot surface review-due candidates"
grep -Fq 'Major `main` must stay green' skills/internal/major-self-maintenance/SKILL.md || fail "Major self-maintenance green-main rule missing"
grep -Fq 'unopened branch' skills/internal/major-self-maintenance/SKILL.md || fail "Major self-maintenance does not conserve GitHub Actions"

# Runtime installation is a release boundary. A red/partial or mutable checkout
# must never silently replace/change the active global Major runtime.
grep -Fq 'refusing to install Major from a dirty checkout' scripts/install-major-runtime.sh || fail "runtime installer does not reject dirty source"
grep -Fq '[ "$INSTALL_BRANCH" != "main" ]' scripts/install-major-runtime.sh || fail "runtime installer does not gate non-main installs"
grep -Fq 'refs/remotes/origin/main' scripts/install-major-runtime.sh || fail "runtime installer does not compare local and remote main"
if grep -Eq 'MAJOR_ALLOW_(DIRTY|NON_MAIN|UNPUSHED)_INSTALL' scripts/install-major-runtime.sh scripts/install-major-global-rules.sh; then
  fail "installer preflight bypass returned"
fi
grep -Fq 'validate-major-release.sh' scripts/install-major-runtime.sh || fail "runtime installer skips canonical release gate"
grep -Fq 'validate-major.sh' scripts/validate-major-release.sh || fail "canonical release gate skips Major doctrine validation"
grep -Fq 'validate-major-stability.sh' scripts/validate-major-release.sh || fail "canonical release gate skips stability validation"
grep -Fq 'validate-major-install-transaction.py' scripts/validate-major-release.sh || fail "canonical release gate skips install rollback proof"
grep -Fq 'pnpm format:check' scripts/validate-major-release.sh || fail "canonical release gate skips format gate"
grep -Fq 'pnpm lint' scripts/validate-major-release.sh || fail "canonical release gate skips lint gate"
grep -Fq 'pnpm typecheck' scripts/validate-major-release.sh || fail "canonical release gate skips typecheck gate"
grep -Fq 'pnpm test' scripts/validate-major-release.sh || fail "canonical release gate skips tests"
grep -Fq 'installed-release.json' scripts/install-major-runtime.sh || fail "runtime installer does not record exact installed release"
grep -Fq 'RELEASES_DIR=' scripts/install-major-runtime.sh || fail "runtime installer has no immutable release store"
grep -Fq 'build-major-runtime-snapshot.sh' scripts/validate-major-release.sh || fail "canonical release gate does not use runtime snapshot builder"
grep -Fq 'exec node "$RELEASE_DIR/dist/entry.js"' scripts/install-major-runtime.sh || fail "active wrapper does not execute immutable release snapshot"
grep -Fq 'runtimeImmutableSnapshot' scripts/install-major-runtime.sh || fail "release record does not state immutable runtime snapshot"
[ -f scripts/stage-major-user-state.py ] || fail "user-state staging helper missing"
[ -f scripts/activate-major-user-state.py ] || fail "user-state transaction activator missing"
[ -f scripts/validate-major-install-transaction.py ] || fail "install rollback validator missing"
grep -Fq 'stage-major-user-state.py' scripts/install-major-runtime.sh || fail "runtime installer does not stage complete user state"
grep -Fq 'activate-major-user-state.py' scripts/install-major-runtime.sh || fail "runtime installer does not activate user state transactionally"
grep -Fq 'launchctl print "$LEGACY_SERVICE"' scripts/install-major-runtime.sh || fail "installer does not verify legacy daemon absence"
grep -Fq 'could not restart the legacy supervisor' scripts/install-major-runtime.sh || fail "installer does not restore a stopped legacy service after rollback"
grep -Fq '.migration.lock' scripts/install-major-runtime.sh || fail "runtime installer does not lock learning migration"
grep -Fq '.migration.lock' scripts/install-major-global-rules.sh || fail "global rules installer does not lock learning migration"
[ -f scripts/acquire-major-learning-migration-lock.py ] || fail "learning migration lock recovery helper missing"
grep -Fq 'STALE_AFTER_SECONDS = 30' scripts/acquire-major-learning-migration-lock.py || fail "learning migration locks have no bounded stale recovery"
grep -Fq 'rm -f "$LEARNING_MIGRATION_LOCK"' scripts/install-major-runtime.sh || fail "runtime installer does not release the committed learning migration lock"
grep -Fq 'rm -f "$LEARNING_MIGRATION_LOCK"' scripts/install-major-global-rules.sh || fail "global rules installer does not release the committed learning migration lock"
grep -Fq 'MAJOR_INSTALL_FAIL_AFTER' scripts/activate-major-user-state.py || fail "transaction activator lacks deterministic failure probe"
grep -Fq 'did not restore live state exactly' scripts/validate-major-install-transaction.py || fail "transaction validator does not compare restored state"

# The builder is the single executable packaging contract and must prove the
# runtime shape rather than relying on grep-only claims.
[ -f scripts/build-major-runtime-snapshot.sh ] || fail "runtime snapshot builder missing"
grep -Fq 'pnpm install --prod --frozen-lockfile --dir' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot does not install production dependencies"
grep -Fq 'cp -R "$ROOT/drizzle"' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot omits DB migrations"
grep -Fq 'cp -R "$ROOT/scripts"' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot omits helper scripts"
grep -Fq 'cp -R "$ROOT/templates"' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot omits project templates"
grep -Fq "return 'agy'" src/providers/commands.ts || fail "supervisor does not use the official Antigravity CLI"
! grep -ERq 'google-antigravity|antigravity-venv' src scripts/install-major-runtime.sh scripts/build-major-runtime-snapshot.sh || fail "obsolete Antigravity SDK path returned"
grep -Fq 'node "$DEST/dist/entry.js" status' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot lacks executable CLI smoke"
grep -Fq 'MAJOR_DB_PATH=' scripts/build-major-runtime-snapshot.sh || fail "runtime snapshot lacks migration smoke"
grep -Fq 'pnpm validate:release' .github/workflows/ci.yml || fail "CI does not execute the canonical release gate"

echo "Major stability validation passed."
