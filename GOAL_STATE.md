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
- Fail closed on qualifying or ambiguous canonical tasks, bind task reviews to their frozen exact
  head, and accept supervisor completion grades only from Major-owned review receipts.
- Require focused and independent task implementation/repair/review runs to carry the frozen
  candidate head, and derive no-task requirements from `decideSdlc` before worker dispatch.
- Run focused/risk-specific checks plus the cheapest relevant type check; do not run the full matrix.

## Evidence

- Starting candidate `d5735a9` was clean and matched the canonical repository identity.
- Final-repair starting head `3e94e66` was clean and matched the canonical repository identity.
- Final implementation head `7385b13` was clean and received the final deterministic gates.
- Execution-independent trust-policy repair started from clean exact candidate `ece2340` with the
  frozen complete-tree digest `3f5d01cd0b69e5ea03ee8317094e6a6062764631f6101291a99276b003535c54`.

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
- Independent review requires a distinct succeeded review execution without `independenceLoss`;
  same-provider evidence qualifies only with canonical execution and provider/account provenance.
- The live coordinator resolves exactly one existing `ready_to_merge` task from repository identity,
  discloses its frozen criteria, and re-resolves it before accepting the cited task ID.
- Independent review requires durable execution separation from implementation or repair work;
  provider diversity is optional corroboration and a missing/compromised marker cannot manufacture
  independence.
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
- Task omission is authoritative only when repository resolution proves there is no canonical task;
  malformed or ambiguous ready-to-merge task state cannot fall through to supervisor evidence.
- Normal supervisor goals freeze a Major-owned no-task promotion contract before dispatch. The
  worker supplies evidence against it but cannot redefine risk, review, or broad-validation need.
- Independent completion grades derive purpose, project, goal, provider, exact head, verdict, and
  evidence from the succeeded provider-owned durable run receipt; CLI caller labels are not authority.
- Progressive independent task review freezes `candidateHead`; implementation and review execution
  separation is evaluated only among succeeded runs bound to that exact head in service and SQLite.
- Every progressive task freezes `candidateHead`, including focused review. Run creation and SQLite
  reject implementation, repair, or review runs whose source head is absent or different.
- Generic performance history remains observational. Only a completed Major provider review run can
  project an append-only independent-review receipt, and only that receipt can grade pending work.
- Pending completion now creates its own durable Major review-dispatch identity after the claim;
  only that successful uncompromised review execution can mint a causally fresh grade.
- Progressive verification, implementation, repair, and review runs all carry the frozen candidate
  head. SQLite rejects mutation of `source_head` after insert and completion ignores other heads.
- Unknown no-task scope freezes as substantive at admission; worker output cannot downgrade it to
  the low-risk fast path, while exact criterion/evidence pairs retain bounded MVP validation.
- Admission now persists a typed Major assessment derived from the admitted outcome and project
  policy. Bounded work keeps the fast path, substantive work requires focused review, consequential
  work requires independent review, and missing classification fails closed at higher risk.
- After a post-pending provider review returns, Major re-reads repository HEAD immediately before
  receipt creation/application and reopens the claim on any mismatch or unreadable head.
- Post-pending review dispatch is read-only at both provider authority and host filesystem
  containment boundaries. Major also freezes and rechecks the complete source-tree digest before
  accepting the receipt, so dirty or untracked mutations cannot hide behind an unchanged HEAD.
- Canonical task completion compares the live repository HEAD with the task's frozen candidate HEAD
  before creating pending completion. Review evidence and task promotion therefore share one SHA.
- Project grades cannot be created or refreshed from a historical receipt after its pending claim
  has closed; the current claim, exact head, and one Major-owned dispatch remain causal authority.
- Typed risk admission recognizes authentication, sessions, access control, identity, tokens,
  privileges, privacy, and related security objectives as consequential. The independent reviewer
  receives the frozen objective, promotion contract, and structured completion evidence.
- Genuine no-task cycles now freeze and persist one Major-owned candidate identity (exact HEAD and
  complete source-tree digest) before dispatch. The worker prompt, structured promotion proof, and
  pending independent review all remain bound to that identity; a pre-dispatch or post-worker
  mismatch reopens the cycle instead of accepting completion evidence.
- Independent review is execution-bound, not provider-name-bound. Major may prefer provider diversity,
  but promotion accepts a same-provider review only through a distinct canonical review run and
  Major-owned dispatch with no `independenceLoss`, read-only containment, exact candidate head/tree,
  and persisted provider/account/run provenance. Compromised execution remains fail-closed.
- Independent grade application performs the final live HEAD/tree read while holding the atomic
  supervisor-state mutation boundary. A mismatch clears pending completion, reopens the goal, and
  throws before project-grade projection, closing the prior check-to-apply race.
- Every provider cycle now freezes one discriminated candidate record before dispatch: task
  candidates include canonical task/project/criteria binding, no-task candidates record that
  resolution explicitly, and ambiguous/invalid resolutions persist diagnostic identity but cannot
  dispatch or become completion authority.
- Non-refining admission backfills typed risk from the preserved durable goal outcome inside the
  atomic admission mutation. A newer ignored message cannot downgrade the existing goal contract.
- Passing independent grades re-resolve the candidate binding and re-run canonical task promotion
  proof inside the final state boundary. Task status, criteria, evidence, BLOCKER, repository, or
  binding drift atomically reopens the goal; no-task candidates also reopen if a task appears.
- No-task promotion contracts are deterministically classified from Major-owned operation facts
  before dispatch; material-risk proof uses exact structured criterion/evidence records persisted in
  pending completion rather than matching free-text prefixes.

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
- Second-review authority repair: omitted task IDs now fail closed for qualifying, malformed, or
  ambiguous task workflows; genuine no-task goals use a pre-dispatch frozen contract; provider-owned
  receipts exclusively supply independent verdicts; task review runs persist and match the frozen
  candidate head; and untriggered broad proof is rejected by service and SQLite. The affected gate
  passed 120/120 tests across seven focused files plus typecheck, targeted lint, and formatting.
- Fresh exact-head binding repair: progressive focused and independent run creation now enforces the
  frozen candidate SHA in service and SQLite; project grading consumes a dedicated append-only review
  receipt rather than arbitrary history; and classifier-derived no-task contracts require exact
  structured material-risk evidence. The affected gate passed 124/124 tests across seven files before
  the final clean-head freeze.
- Different-provider causal repair: generic history no longer projects completion authority; a
  post-claim Major review dispatch binds project, goal, exact head, provider, purpose, successful
  execution, provider verdict, and dispatch time in one append-only receipt. Progressive verification
  joins the exact-head service/SQLite gate and source heads are immutable. The affected gate passed
  90/90 focused tests across five files plus typecheck, targeted lint/format, Major validation, and
  stability validation; the full matrix remains intentionally unrun.
- Fresh post-review/admission repair: the receipt boundary now performs a second exact-HEAD read and
  reopens stale claims before authority is recorded. Canonical and ambient admission persist a typed
  outcome/policy risk assessment with conservative legacy/unavailable migration. The affected gate
  passed 99/99 focused tests across six files plus typecheck; the full matrix remains intentionally
  unrun and the account-label IMPORTANT remains non-blocking.
- Read-only causal-review repair: the host containment profile now admits source roots for reads but
  reserves writes for runtime scratch roots; post-review source hashing detects same-HEAD mutations;
  task pending completion checks the live frozen SHA; closed claims cannot replay receipts into
  grades; and expanded typed security admission feeds a complete frozen review prompt. The affected
  final gate passed 91/91 focused tests across four ordinary files plus typecheck, targeted source
  lint, formatting, and diff checks. The resource-only containment file passed 6 non-Seatbelt checks;
  its 7 sandbox-dependent checks (including the new read-only regression and six pre-existing checks)
  could not apply nested Seatbelt in the leased sandbox and returned `sandbox_apply: Operation not
permitted`, so runtime containment proof remains for the parent exact-head validation boundary.
- No-task candidate identity repair: exact HEAD and source-tree digest are frozen durably before the
  worker runs, disclosed in its prompt, checked before dispatch and after reporting, and persisted in
  pending review. Final grade application re-reads both identities inside the atomic state boundary;
  same-HEAD tree mutation and committed-HEAD replacement both reopen without grading. The affected
  gate passed 100/100 focused tests across five files plus typecheck, targeted lint, formatting, and
  diff checks; the full matrix remains intentionally unrun.
- Discriminated candidate/final-task-proof repair: task, no-task, ambiguous, and invalid resolution
  share one frozen pre-dispatch record; non-authoritative bindings stop before provider execution;
  preserved-outcome risk backfill cannot use ignored input; and final passing grades re-resolve and
  re-prove canonical task authority. The affected gate passed 108/108 focused tests across six files
  plus typecheck, targeted lint, formatting, and diff checks; the full matrix remains intentionally
  unrun.
- Typecheck, source lint, repository formatting, production build, Major validator, and stability
  validator passed.
- Canonical repository-writer-fence repair: the integration owner, direct worker CLI, mutation-capable
  worker execution, and independent completion transition now share one repository-scoped writer
  lease. A refused writer records contention, so an arrival after the final HEAD/tree read forces the
  SQLite completion transaction to roll back and the goal to reopen. The affected gate passed 80/80
  tests across four focused files plus typecheck, targeted lint, and formatting; the full matrix was
  intentionally not run.
- Commit-boundary fence repair: completion authority now uses an explicit `BEGIN IMMEDIATE` transaction,
  and the repository writer fence owns the guarded SQLite commit. A deterministic competing writer
  injected after the fence assertion but before COMMIT records contention; the guard rolls back the
  authority row and the supervisor goal reopens. The affected gate passed 80/80 tests across four
  focused files plus typecheck, targeted lint, and formatting. The broad matrix was not run because
  the requested proportional gate bounded validation to the changed completion path.
- Broader-validation evidence (append-only): candidate `3a329a25` triggered the bounded broader gate
  for blast radius across shared run creation, admission, task completion, SQLite enforcement, and
  migrations. Cost was one nine-file test invocation (6.86 seconds wall time; 9.96 seconds aggregate
  test time); expected information gain was detecting frozen-head fixture drift and authority/schema
  regressions without paying for the unrelated full matrix. After explicitly binding qualifying
  verification fixtures to their frozen candidate head, all 9 files and 138/138 tests passed.
- Execution-independent-review repair: service and SQLite promotion no longer require provider-name
  inequality. The supervisor no longer excludes the implementing host, while receipt minting and grade
  application still require a separate succeeded canonical review run, Major dispatch causality, exact
  head, routed provider/account provenance, and no execution-independence loss. The proportional gate
  passed 127/127 tests across seven affected routing, migration, task/SQLite, receipt, runtime, and
  completion files plus typecheck, targeted lint, and formatting; no unrelated full matrix was run.
- Execution-independent trust-policy/guidance/skill repair: project trust grades now retain distinct
  reviewed/reviewer execution IDs plus provider/account provenance, reject self-execution and compromised
  or accountless grades, and permit same-provider review only when those execution predicates hold. The
  active CLI guidance, capability matrix, skill registry/catalog, prior-art decision, and both review
  skills now state the same rule. Blast radius justified a bounded broader gate: one 12-file runtime,
  policy, completion, migration, provenance, guidance, and skill-lifecycle invocation passed 161/161
  tests in 8.83 seconds; the two resource-config resolver suites passed 99/99 in 3.87 seconds. This
  approximately 13-second cost had high expected information gain because it covered every changed
  policy consumer and skill-routing boundary while avoiding the unrelated full matrix. Typecheck,
  targeted lint, formatting, skill validation, and the primary Major validator passed. The stability
  validator reached its unchanged frozen-candidate exception: it greps lowercase `commondir` while the
  worktree-aware implementation uses `commonDir`; this patch changes neither file.
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
- Independent review regression: `9bdde464` allowed task omission to bypass ambiguous canonical
  state, let callers shape project-grade verdicts, lacked task-run exact-head persistence, derived
  no-task requirements from the completing report, and accepted untriggered canonical broad proof.
  Focused authority and parity regressions now protect those seams.
- Independent review regression: `37096b5` stored task source heads without requiring them at run
  creation, let generic history objects feed grading, defaulted no-task requirements outside the SDLC
  classifier, and matched risk evidence by text prefix. Focused service/SQLite/receipt/classifier
  regressions now protect those authority boundaries.
- Independent review regression: `2b8ea1ef` still let generic history mint review authority, had no
  post-claim review execution state, allowed stale/self-shaped receipts, omitted verification from
  exact-head enforcement, permitted source-head mutation, and classified unknown supervisor scope
  as low risk. Focused causal, receipt, run-service, and SQLite regressions now protect these seams.
- Independent review regression: `09a1b313` checked exact HEAD only before provider dispatch and
  classified admission without typed outcome/project-policy facts. Focused regressions now protect
  the second pre-receipt HEAD read and bounded/substantive/consequential/unavailable contracts.
- Independent review regression: `4a245e1a` left the post-claim reviewer able to mutate admitted
  source roots, compared only HEAD rather than the source tree, did not align live task HEAD before
  pending completion, allowed closed-claim grade replay, and under-classified common auth/session
  objectives. Focused boundary regressions now protect each causal and read-only seam.
- Independent review regression: `0c9f16f` sampled no-task source identity only after worker return
  and performed its last HEAD/tree check before the grade transition, allowing candidate mutation or
  a check-to-apply race. Focused foreground and grade-boundary regressions now protect durable
  pre-dispatch identity plus atomic same-tree and changed-HEAD rejection.
- Replacement review regression: `cdcd736` froze identity only for no-task resolution, let a
  non-refining admission backfill risk from ignored incoming text, and did not re-resolve/re-prove a
  canonical task at final grade application. Focused candidate, admission, successful-task, and
  late-BLOCKER regressions now protect those seams.
- Independent review regression: `5870e3a` retained the prior objective's pending claim, frozen
  candidate, and review dispatch across explicit refinement, and final task proof was not fenced from
  concurrent SQLite authority changes through the supervisor done transition. Refinement now revokes
  the old authority epoch first, while an immediate transaction serializes final binding/proof and
  state transition; 73/73 affected tests plus typecheck, targeted lint, and formatting passed.
- Independent review regression: `1a386ac` left the final authority in SQLite and supervisor done in
  a separate JSON write without a recovery projection, sampled source identity outside the authority
  write, and accepted a gateway run ID without a canonical task/provider-account run. SQLite now owns
  one append-only completion commit, JSON state recovers from it, the write performs a post-insert
  exact HEAD/tree fence with rollback and reopen, and receipts require the succeeded persisted review
  run for the exact task, head, purpose, provider, and routed account. The proportional gate passed
  71/71 affected migration, receipt, runtime, and completion tests plus typecheck, targeted lint, and
  formatting; the full matrix was intentionally not run.
- Independent review regression: `667a69e` still released repository identity from observation before
  SQLite committed completion authority. The canonical writer lease now spans the final HEAD/tree read
  through commit and every supervisor mutation-capable worker entry point. A focused race attempts a
  tree write after that read, proves the writer is excluded, and proves recorded contention rolls back
  the completion commit and reopens the goal.
- Independent review regression: `899ec55` checked contention in the transaction callback, after which
  the transaction helper still had to perform COMMIT. Completion now uses a fence-owned explicit commit
  primitive; a writer injected after its last assertion and before transaction completion prevents the
  append-only authority row from committing and reopens the pending goal.
- Broader-validation regression: `3a329a25` passed the focused completion fence but two direct-SQL
  enforcement cases used qualifying verification fixtures without the task's frozen candidate head.
  The fixtures now provide that exact head; production `createRun` and SQLite frozen-head enforcement
  remain strict, and the repaired affected broader gate passes 138/138.
- Release-policy correction: provider-name diversity was previously treated as the independence
  predicate, blocking a separately dispatched read-only review on the same provider and allowing the
  provider label to overshadow execution provenance. Independence now derives from the canonical
  review execution and its uncompromised receipt; provider and account remain durable provenance.
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
