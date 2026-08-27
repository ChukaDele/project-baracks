# Major 2.0 legacy migration receipt

Status: **normal path migrated**. This receipt preserves the legacy migration
decisions and evidence. The canonical runtime is now the headless Major core
over live provider CLIs, with Orca as the operational workspace surface. DSH
and Lima are retained only as explicit compatibility/reference paths.

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
- orchestration/memory → headless Major core with human-readable Major
  policy/memory remaining canonical; Ruflo stays optional and subordinate.

## RETAINED HISTORICAL / COMPATIBILITY EVIDENCE

- attested DSH packages, receipts, logs, sessions and incident fixtures needed
  to explain and compare the former runtime;
- the explicit Lima execution backend for deliberate high-isolation or rollback
  compatibility runs;
- provider credentials and account evidence, which cleanup must never delete;
- tests that prove compatibility paths remain isolated from the host default.

These are retained evidence and explicit compatibility boundaries, not normal
runtime dependencies or permanent launch requirements.

## DELETE after successor verification

- hard-coded gates whose sole purpose is to make live agent execution/autonomous completion impossible.
- obsolete tests asserting those retired refusals.
- deferred-security milestone material describing capabilities that are now implemented/reframed.
- stale Surface Talent-specific positioning/configuration that does not belong in the cross-project harness.
- obsolete provider/model class assumptions and Codex-review-only reserve behaviour.
- duplicate/obsolete guidance files or registry entries.
- stale `project-baracks` naming once the repository is renamed to Major.
- dead flags, adapters, docs and code paths discovered by stale-reference scan.

## Normal-path completion evidence

The thin migration's P0 completion gate is satisfied by the current bounded
evidence:

1. The selected execution path is `host`, and the provider process runs through
   the single Major gateway under macOS Seatbelt containment.
2. A live Codex task completed through that path and produced a durable
   `major.run-insight.v1` receipt with timing and outcome evidence.
3. Orca resolved the canonical repository and worktree boundary without
   becoming a second policy or memory store.
4. Retained intelligence—project context, skills, GBrain learning and run
   history—survived restart and was behaviorally retrieved.
5. The thin `major ui` surface read that same durable state without starting a
   worker.
6. Cleanup inventory kept historical receipts, logs, sessions, stores,
   credentials, incidents, outcomes and validated learnings while classifying
   only replaced generated runtime state as reclaimable.
7. The full validation run passed 102 test files and 852 tests, including host
   containment and Lima compatibility.

The detailed current proof is maintained in
`docs/migrations/deepseek-harness-strangler.md` and `docs/readiness-model.md`.
Git history remains the archive for removed implementation.

## Follow-on work that does not reopen P0

- Each additional provider lane needs its own human authentication and
  representative evidence before routing promotion.
- Multi-worker comparisons need enough outcomes to support a policy decision;
  contract-tested fallback remains the safe default in the meantime.
- Generated DSH/Lima runtime trees may be reclaimed only after an inventory
  proves zero active consumers and retained-evidence exclusions.
- Ruflo and external observability exporters remain optional integrations.
- Repository renaming remains a repository-owner operation.

These items must not be represented as already proven, but they do not make the
normal headless path depend on the replaced DSH workstation.
