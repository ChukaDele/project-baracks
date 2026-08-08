# Major 2.0 legacy migration receipt

Status: **in progress**. This receipt exists to ensure the migration finishes with one canonical Major runtime rather than old and new systems coexisting indefinitely.

## KEEP / evolve

- `major` product/CLI identity.
- Git history.
- durable task/run/evidence concepts and useful database history/schema where compatible.
- instruction precedence concept, rewritten for clean supersession.
- secret redaction and project-root containment concepts.
- model state dimensions: availability/rate-limit/exhaustion/billing mode/capability.
- explicit evidence over agent self-report.
- project boundaries and protected-resource concepts.

## MIGRATE

- model routing → Claude Code + Codex + Antigravity + Cursor, subscription-first, adaptive concurrency.
- security → risk-proportional MVP safety floor rather than front-loaded enterprise hardening.
- task scope → end-to-end outcomes/vertical slices rather than fractional narrowly bounded work.
- human approvals → retain only genuine owner-only gates; allow safe reversible engineering autonomously.
- guidance → proof-first MVP, autonomy, UI reuse, legacy cleanup and current cross-project skills.
- reusable learnings/skills from JSS → Major canonical library.
- orchestration/memory → Ruflo-backed substrate with human-readable Major policy/memory remaining canonical.

## RETAIN TEMPORARILY UNTIL REPLACEMENT PROOF

- old live-execution refusal/gate code only while it protects the current main branch from accidental execution before the new gateway is ready.
- tests for the old disabled foundation only until replacement execution-policy tests exist.
- old routing/provider implementation only until new provider adapters pass bounded execution and failover tests.

These are temporary migration dependencies, not permanent compatibility promises.

## DELETE after successor verification

- hard-coded gates whose sole purpose is to make live agent execution/autonomous completion impossible.
- obsolete tests asserting those retired refusals.
- deferred-security milestone material describing capabilities that are now implemented/reframed.
- stale Surface Talent-specific positioning/configuration that does not belong in the cross-project harness.
- obsolete provider/model class assumptions and Codex-review-only reserve behaviour.
- duplicate/obsolete guidance files or registry entries.
- stale `project-baracks` naming once the repository is renamed to Major.
- dead flags, adapters, docs and code paths discovered by stale-reference scan.

## Completion gate

Do not call the Major 2.0 migration complete until:

1. Ruflo-backed orchestration executes a bounded real task through at least the primary worker lanes intended for launch.
2. one multi-agent worktree task completes with objective evidence.
3. provider/rate-limit fallback is demonstrated or contract-tested.
4. Major memory/skill retrieval works without loading the whole library into context.
5. a real project consumes the Major bootstrap successfully.
6. old disabled execution paths and stale assumptions above are deleted.
7. repository-wide stale-reference scan has no unexplained legacy matches.
8. critical Major tests and one end-to-end harness smoke pass after cleanup.

Git history remains the archive for removed Major v1 implementation.