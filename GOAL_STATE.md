# Goal state

## Active outcome

Add the smallest credible Major SDLC policy slice: low overhead for small work,
compact intent-to-spec-to-plan-to-evidence state for substantive work,
risk-proportional review, separate regression and learning artifacts, and truthful
delivery states without replacing existing orchestration, policy, evidence, or GBrain paths.

## Work profile

Substantive. Risk: authority/process semantics. Review: independent.

## Acceptance evidence

- A small low-risk task requires only outcome, acceptance, and deterministic proof.
- Substantive work requires outcome, acceptance, plan, and evidence.
- Consequential risk raises review to independent even for a one-file change.
- Failure regression stays project-specific while reusable learning is a separate candidate.
- BUILT, VALIDATED, and READY resolve only from their required evidence.

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

Built. Focused deterministic checks and repository validators pass. Independent exact-head
review has not run, so VALIDATED is not claimed. Installation and installed behavior remain
explicitly unproven.

Installation proof: unproven.
Representative installed behaviour proof: unproven.

## Current bottleneck

Freeze and commit the candidate, then obtain independent exact-head review through the parent
resource coordinator. Supported installation and installed behavior proof follow normal merge.

## Decisions and discoveries

- REUSE and extend the canonical goal-state template; do not create a second state store.
- Add a pure policy primitive; preserve task lifecycle, worktrees, evidence, review, and learning.
- Treat risk as an explicit caller fact rather than guessing it from task prose.
- Do not mandate independent review for bounded low-risk tasks.
- Keep installation and representative behavior proof separate; neither source checks nor
  installation alone imply READY.
- WRAP the existing state/readiness paths per `docs/prior-art-decisions.md`; add no new store.

## Completed evidence

- Final focused suite: 5 files and 33/33 tests passed, including the low-risk no-review path,
  substantive review gate, installation/behavior proof, prior-art, autonomy, and artifacts.
- Typecheck, source lint, repository formatting, Major validator, and stability validator passed.
- Ordinary repository tests made broad progress but sandbox-only host Git/Node/listener checks
  failed or hung; the run was stopped after evidence collection. No SDLC test failed.
- Resource suite: 132 passed, 5 expected skips, 8 sandbox/path failures. No candidate-touched
  test failed.

## Failure regression

- Environment regression: repository suites that deliberately inspect host Git, Node, nested
  Seatbelt, Lima, or listeners cannot all pass inside the provider Seatbelt boundary. Focused
  project-local checks run with an isolated `MAJOR_HOME` and remain authoritative for this slice.
- Generalisable learning is already captured in active Major learning; no duplicate candidate.

## Next executable action

Request an independent read-only exact-head review of the committed candidate. After normal merge,
install the exact SHA and record installed behavior proof.

## Owner-only gate

Normal push/merge and supported installed-runtime proof remain on the owner/integration path.
