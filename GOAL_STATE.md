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

- Add task-applicable delivery-state evidence without adding a store or universal gates.
- Preserve the compact-state contract and review/readiness semantics with focused regressions.
- Run deterministic focused and repository checks, then commit a new exact head.

## Evidence

- Starting candidate `d5735a9` was clean and matched the canonical repository identity.
- Final-repair starting head `3e94e66` was clean and matched the canonical repository identity.

Delivery evidence:

- IMPLEMENTED: proven — pure assessment code exists in `src/domain/sdlc.ts`.
- TESTED: proven — 5 focused files and 38/38 tests pass with repository checks.
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

BUILT. The final acceptance repair and focused regressions pass deterministic checks. Independent
exact-head review has not run, so VALIDATED is not claimed. Installation and installed behavior
remain explicitly unproven.

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
- Use only BLOCKER/IMPORTANT/NIT findings; nits and speculation never block promotion.
- Apply delivery evidence only to task-relevant states; irrelevant states are `not_required`.

## Completed evidence

- Repaired focused suite: 5 files and 36/36 tests passed, including exact intent/spec/plan/evidence,
  low-risk no-review, review severity, installation/behavior proof, prior-art, autonomy, and artifacts.
- Final delivery-evidence repair: 5 focused files and 38/38 tests passed; all eight states are
  explicit, applicable states require evidence, and irrelevant states resolve to `not_required`.
- Typecheck, source lint, repository formatting, production build, Major validator, and stability
  validator passed.
- Ordinary repository tests made broad progress but sandbox-only host Git/Node/listener checks
  failed or hung; the run was stopped after evidence collection. No SDLC test failed.
- Resource suite: 132 passed, 5 expected skips, 8 sandbox/path failures. No candidate-touched
  test failed.

## Failure regression

- Candidate regression: `d5735a9` used outcome/acceptance and P0-P3 vocabulary. Focused tests now
  require exact intent/spec/plan/evidence headings and BLOCKER/IMPORTANT/NIT semantics, including
  non-blocking nits and speculation.
- Candidate regression: `3e94e66` exposed only generic review/installation/behavior proof. Focused
  tests now require all eight delivery-evidence states while exempting task-irrelevant states.
- Environment regression: repository suites that deliberately inspect host Git, Node, nested
  Seatbelt, Lima, or listeners cannot all pass inside the provider Seatbelt boundary. Focused
  project-local checks run with an isolated `MAJOR_HOME` and remain authoritative for this slice.
- Generalisable learning is already captured in active Major learning; no duplicate candidate.

## Next executable action

Request an independent read-only exact-head review of the repaired SHA. After normal merge,
install the exact SHA and record installed behavior proof.

## Owner-only gate

Normal push/merge and supported installed-runtime proof remain on the owner/integration path.
