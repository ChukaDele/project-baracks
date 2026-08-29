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

- Connect the progressive-validation plan and non-circular PROMOTABLE assessment to the existing
  coordinator, frozen completion-criteria, verification/evidence, and SQLite trigger paths.
- Bind coordinator `done` to the canonical task and reject compromised review as independent proof.
- Keep the strict service and SQLite criteria schemas aligned, including persisted validation cost
  versus expected information gain.
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
- BEHAVIORALLY PROVEN: unproven — representative installed behavior has not run.

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
- Default to focused changed-behavior, cheapest compile/type/build, critical-path, and material-risk
  checks. Prohibit broad suites unless the five explicit triggers or repository policy apply, and
  require cost versus expected information-gain reasoning.
- PROMOTABLE requires pre-promotion evidence, selected review, and no BLOCKER; install/behavior
  remain later READY evidence.
- Canonical review severities reuse the existing store: BLOCKER writes `critical`, IMPORTANT writes
  `minor`, NIT writes `info`, and legacy `major` remains a safe BLOCKER alias.
- Canonical delivery evidence uses `BEHAVIORALLY PROVEN`; the prior British spelling remains an
  accepted read alias so existing records are not discarded.
- Coordinator `done` claims require a canonical task ID whose frozen evidence is PROMOTABLE;
  installation remains later proof and old pending-completion records remain readable.
- Independent review requires a succeeded review run without `independenceLoss`; same-provider
  review evidence cannot silently satisfy that gate.
- The live coordinator resolves exactly one existing `ready_to_merge` task from repository identity,
  discloses its frozen criteria, and re-resolves it before accepting the cited task ID.
- Independent review requires durable provider separation from every succeeded implementation or
  repair run; a missing/compromised marker alone cannot manufacture independence.
- Required decisions are owned by both the canonical task and its project in service and SQLite;
  whitespace-only decision/risk criteria are rejected at both boundaries.
- Normal supervisor goals carry structured pre-promotion evidence from `WorkerReport` into
  `pendingCompletion`; they do not require a task row that the supervisor lifecycle does not create.
- Explicit task workflows retain repository-resolved frozen criteria and SQLite completion proof;
  summary-only supervisor done claims cannot enter pending independent validation.
- A qualifying canonical task is disclosed only when repository resolution finds one; normal goals
  remain on structured report evidence without treating task absence as a blocker.
- Independent supervisor grading consumes durable provider-run identity bound to the pending exact
  head; task review compares canonical provider names, not account-specific provider row IDs.
- Every material-risk criterion owns a distinct verification subject in service and SQLite. Broad
  validation must be triggered, and any performed broad run records cost, information gain, and proof.

## Completed evidence

- Repaired focused suite: 5 files and 36/36 tests passed, including exact intent/spec/plan/evidence,
  low-risk no-review, review severity, installation/behavior proof, prior-art, autonomy, and artifacts.
- Final delivery-evidence repair: 5 focused files and 38/38 tests passed; all eight states are
  explicit, applicable states require evidence, and irrelevant states resolve to `not_required`.
- Review-semantics repair: 5 focused files and 38/38 tests passed; BLOCKER blocks, IMPORTANT
  triages without automatically blocking, and NIT/speculation remain advisory.
- Progressive-validation/PROMOTABLE repair: 17/17 focused SDLC tests, typecheck, targeted lint and
  formatting, Major validation, and stability validation passed. The full matrix was not rerun.
- Live-prompt repair: the coordinator prompt and worker policy now carry the progressive-validation
  requirements, broad-suite triggers, and cost/information-gain gate. The proportional gate passed
  58/58 focused prompt/policy tests, typecheck, targeted source/policy lint, formatting, Major
  validation, and stability validation. The full matrix was not rerun.
- Targeted lint of the entire supervisor-runtime test file also surfaced two pre-existing
  `no-unsafe-assignment` errors at unchanged lines 133 and 186; they are outside this candidate's
  focused assertions and are not recast as passing evidence.
- Completion-boundary repair: opt-in progressive criteria now resolve required validation subjects
  through qualifying verification/evidence rows, require the selected succeeded review, call the
  PROMOTABLE assessment, and enforce the same rules in SQLite. The proportional gate passed 89/89
  focused tests across policy, coordinator prompt, service completion, and direct-SQL enforcement;
  the full matrix was not rerun.
- Fresh-review repair: coordinator completion is task-bound, independent review excludes compromised
  runs, SQLite validates the strict progressive schema, and broad validation freezes cost and
  expected information gain. The proportional gate passed 98/98 focused tests across five affected
  files; the full matrix remains intentionally unrun.
- Repository-binding parity repair: the coordinator now derives and discloses the real canonical task
  and frozen criteria from the repository, rejects arbitrary task IDs, requires durable review-provider
  separation, and aligns service/SQLite decision ownership and whitespace validation. The proportional
  gate passed 99/99 focused tests across five affected files plus typecheck, targeted lint, and format;
  the full matrix remains intentionally unrun.
- Supervisor-lifecycle repair: normal goals now assess focused, compile/type/build, critical-path,
  material-risk, broad-validation economics, review, and BLOCKER evidence directly from the bounded
  worker report and persist that evidence for independent grading. Explicit task workflows retain the
  repository/SQLite path. The proportional gate passed 100/100 focused tests across five affected
  files plus typecheck, targeted lint/format, Major validation, and stability validation; the full
  matrix remains intentionally unrun.
- Exact-head evidence repair: optional task disclosure preserves normal supervisor flow; durable run
  receipts bind independent grading to provider and exact head; provider aliases cannot manufacture
  task-review independence; and each risk criterion plus broad-validation economics is enforced in
  service and SQLite. The proportional gate passed 101/101 focused tests across five affected files;
  the full matrix remains intentionally unrun.
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
- Candidate regression: `4d5f931` implemented the pure policy but did not carry its progressive
  validation contract in the live coordinator prompt. Focused prompt/policy tests now protect that
  operational path.
- Independent review regression: `b6433f8` left the new helpers disconnected from durable
  completion and lacked an explicit canonical-to-storage severity mapping. Focused service and
  direct-SQL regressions now prove IMPORTANT remains non-blocking and BLOCKER blocks.
- Independent review regression: `14c2f4c` allowed coordinator completion outside canonical task
  proof, counted compromised review as independent, accepted looser SQLite criteria, and described
  rather than persisted validation economics. Focused boundary regressions now protect each seam.
- Independent review regression: `3e70b04` still accepted a worker-invented task ID, matched project
  display names instead of repository identity, treated an unmarked same-provider review as independent,
  and differed between service/SQLite on decision ownership and whitespace. Focused parity tests now
  protect those exact boundaries.
- Independent review regression: `a5ef4b2` made all supervisor completion depend on exactly one
  registered `ready_to_merge` task even though normal supervisor goals do not create task rows.
  Focused lifecycle regressions now prove structured no-task promotion, summary-only rejection,
  broad-validation economics, BLOCKER handling, and legacy pending-completion readability.
- Independent review regression: `617f3cbd` omitted conditional task disclosure, trusted caller
  provider labels during completion grading, compared task providers by row ID, collapsed all risks
  into one proof, and allowed untriggered broad validation. Focused parity regressions now protect
  provider/head provenance and each evidence boundary.
- Repository exception: the final resource gate has one pre-existing skill-reachability failure
  covering 14 orphan writing/brand IDs; the 139 resource tests themselves passed with 5 expected
  skips. The durable record does not recast that exception as candidate success.
- Generalisable learning is already captured in active Major learning; no duplicate candidate.

## Next executable action

Request an independent read-only exact-head review of the repaired SHA. After normal merge,
install the exact SHA and record installed behavior proof.

## Owner-only gate

Normal push/merge and supported installed-runtime proof remain on the owner/integration path.
