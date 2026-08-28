# Goal state

## Intent

Add the smallest credible Major SDLC policy slice: low overhead for small work,
compact intent-to-spec-to-plan-to-evidence state for substantive work,
risk-proportional review, separate regression and learning artifacts, and truthful
delivery states without replacing existing orchestration, policy, evidence, or GBrain paths.

## Work profile

Substantive. Risk: authority/process semantics. Review: independent.

## Spec

- A small low-risk task requires only intent, spec, and deterministic proof.
- Substantive work requires intent, spec, plan, and evidence.
- Consequential risk raises review to independent even for a one-file change.
- Failure regression stays project-specific while reusable learning is a separate candidate.
- BUILT, VALIDATED, and READY resolve only from their required evidence.

## Plan

- Add a pure progressive-validation plan and explicit non-circular PROMOTABLE assessment.
- Preserve compact state, review semantics, delivery evidence, and READY behavioral proof.
- Run focused/risk-specific checks plus the cheapest relevant type check; do not run the full matrix.

## Evidence

- Starting candidate `d5735a9` was clean and matched the canonical repository identity.
- Final-repair starting head `3e94e66` was clean and matched the canonical repository identity.
- Final implementation head `7385b13` was clean and received the final deterministic gates.

Delivery evidence:

- IMPLEMENTED: proven — pure assessment code exists in `src/domain/sdlc.ts`.
- TESTED: proven — exact implementation head `7385b13` passed 38/38 focused tests, 106/106
  ordinary test files and 910/910 ordinary tests; the resource run passed 139 tests with 5
  expected skips and reported the pre-existing 14-ID skill-reachability exception.
- STAGED: proven — repaired candidate is committed in the isolated exact-head worktree.
- RESOLVED: proven — all eight task-applicable evidence states have focused regression proof.
- LOADED: not required — this slice adds no loadable runtime/configuration artifact.
- FOLLOWED: proven — canonical template/prior-art paths are extended without a new store.
- INSTALLED: unproven — supported exact-SHA installation has not run.
- BEHAVIOURALLY PROVEN: unproven — representative installed behavior has not run.

## Critical-path dependencies

- Implementation and focused tests → this isolated exact-head worktree → complete.
- Dependency-backed focused checks → this isolated exact-head worktree → complete.
- Independent exact-head review → parent coordinator/reviewer → pending.
- Normal push/merge/install promotion → owner/integration path → pending.

## Ownership and interfaces

- SDLC policy → `src/domain/sdlc.ts` → pure deterministic API, no new store.
- Durable operator state → `GOAL_STATE.md` template → existing project path.
- Regression proof and reusable learning → project tests plus existing GBrain lifecycle.

## Current status

BUILT. The progressive-validation and PROMOTABLE repair passes its proportional deterministic
checks. Independent review has not run, so VALIDATED and PROMOTABLE are not claimed. The candidate
has not been merged or installed, and installed behavior remains unproven.

Installation proof: unproven.
Representative installed behaviour proof: unproven.

## Current bottleneck

Obtain independent exact-head review through the parent resource coordinator. Supported
installation and installed behavior proof follow normal merge.

## Decisions and discoveries

- REUSE and extend the canonical goal-state template; do not create a second state store.
- Add a pure policy primitive; preserve task lifecycle, worktrees, evidence, review, and learning.
- Treat risk as an explicit caller fact rather than guessing it from task prose.
- Do not mandate independent review for bounded low-risk tasks.
- Keep installation and representative behavior proof separate; neither source checks nor
  installation alone imply READY.
- WRAP the existing state/readiness paths per `docs/prior-art-decisions.md`; add no new store.
- Use only BLOCKER/IMPORTANT/NIT findings: BLOCKER blocks; IMPORTANT is triaged without
  automatically blocking a usable and safe MVP; nits and speculation never block.
- Apply delivery evidence only to task-relevant states; irrelevant states are `not_required`.
- Default to focused, cheapest compile/type/build, and critical-path checks; broaden only for the
  five explicit triggers.
- PROMOTABLE requires pre-promotion evidence, selected review, and no BLOCKER; install/behavior
  remain later READY evidence.

## Completed evidence

- Repaired focused suite: 5 files and 36/36 tests passed, including exact intent/spec/plan/evidence,
  low-risk no-review, review severity, installation/behavior proof, prior-art, autonomy, and artifacts.
- Final delivery-evidence repair: 5 focused files and 38/38 tests passed; all eight states are
  explicit, applicable states require evidence, and irrelevant states resolve to `not_required`.
- Review-semantics repair: 5 focused files and 38/38 tests passed; BLOCKER blocks, IMPORTANT
  triages without automatically blocking, and NIT/speculation remain advisory.
- Progressive-validation/PROMOTABLE repair: 17/17 focused SDLC tests, typecheck, targeted lint and
  formatting, Major validation, and stability validation passed. The full matrix was not rerun.
- Typecheck, source lint, repository formatting, production build, Major validator, and stability
  validator passed.
- Final implementation-head gate for `7385b13`: 38/38 focused tests passed.
- Final ordinary gate for `7385b13`: 106/106 files and 910/910 tests passed.
- Final resource gate for `7385b13`: 139 tests passed with 5 expected skips.
- The resource gate also reported one pre-existing skill-reachability failure covering 14 orphan
  writing/brand IDs. It is recorded as an unresolved repository exception, not an SDLC candidate
  failure and not a readiness claim.

## Failure regression

- Candidate regression: `d5735a9` used outcome/acceptance and P0-P3 vocabulary. Focused tests now
  require exact intent/spec/plan/evidence headings and BLOCKER/IMPORTANT/NIT semantics, including
  non-blocking nits and speculation.
- Candidate regression: `3e94e66` exposed only generic review/installation/behavior proof. Focused
  tests now require all eight delivery-evidence states while exempting task-irrelevant states.
- Candidate regression: `4add22e` automatically blocked promotion for an unaccepted IMPORTANT
  finding. Focused tests now require IMPORTANT to return `triage` without blocking promotion.
- Candidate regression: `6f05ab9` had no explicit progressive-validation plan or PROMOTABLE state.
  Focused tests now protect proportional escalation and the non-circular merge/install boundary.
- Repository exception: the final resource gate has one pre-existing skill-reachability failure
  covering 14 orphan writing/brand IDs; the 139 resource tests themselves passed with 5 expected
  skips. The durable record does not recast that exception as candidate success.
- Generalisable learning is already captured in active Major learning; no duplicate candidate.

## Next executable action

Request an independent read-only exact-head review of the repaired SHA. After normal merge,
install the exact SHA and record installed behavior proof.

## Owner-only gate

Normal push/merge and supported installed-runtime proof remain on the owner/integration path.
