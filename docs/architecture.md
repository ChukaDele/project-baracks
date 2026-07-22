# Architecture

Major is designed to become an autonomous engineering supervisor: planning,
dispatching, monitoring and verifying work performed by agent CLIs (Claude Code,
Codex) across configured projects, starting with Surface Talent.

**This build is a disabled architectural foundation — dry-run and inspection only.**
Five capabilities are unavailable, enforced by the hard-coded capability gate
(`src/security/capabilities.ts`): live agent execution, paid provider execution,
automated task completion, worker-owned downstream mutations, and external roadmap
application. The gate consults no configuration, environment variable or flag, and
every quarantined entry point refuses before any side effect. Each capability
returns via its own milestone and independent review
(`docs/deferred-security-milestones.md`).

## Stack decisions

| Decision        | Choice                                                                          | Why                                                                                                     |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime         | Node.js ≥ 22, ESM, strict TypeScript (`nodenext`)                               | matches the CLIs it orchestrates; strict mode + `exactOptionalPropertyTypes` catch state-model mistakes |
| Package manager | pnpm (via corepack)                                                             | mandated; lockfile committed                                                                            |
| State           | SQLite via better-sqlite3 + Drizzle ORM                                         | single-file, transactional, no external service                                                         |
| Migrations      | drizzle-kit generated SQL in `drizzle/`, applied on DB open                     | schema history is reviewable SQL                                                                        |
| Validation      | Zod at every boundary (configs, registries, adapters)                           | invalid config fails loudly at load time                                                                |
| CLI             | commander (`major …`), runnable via `pnpm major …` or built `dist/cli/index.js` |                                                                                                         |
| Tests           | Vitest, in-memory SQLite                                                        | full suite runs in ~1s with zero external calls                                                         |
| Logs            | structured JSON lines to stderr, redacted before write                          | machine-parseable, secret-safe                                                                          |

## Layering

```
src/
  domain/      lifecycle state machine, task/run/claim/decision services, completion proof
  db/          Drizzle schema (20 entities), client, migrations
  providers/   capability registry, provider contracts, exec engine, discovery store, mock
  routing/     model-aware resource router (pure decision function), checkpoint records
  roadmap/     roadmap adapter contract, shared validation, canonical hashing, proposal service, Sheets mock
  config/      generic project adapter (zod), project persistence
  guidance/    instruction/skills registry loader (supersession-aware)
  security/    execution gateway, redaction, path containment, argv command policy, env sanitisation, audit
  logging/     redacting JSON logger
  doctor/      environment/prerequisite report
  cli/         commander wiring only — no business logic
```

Dependency direction: `cli → {doctor, routing, providers, domain, config} → db/security`.
The router and lifecycle machine are pure functions; everything effectful (DB, spawn) is
injected, which is what keeps the test suite hermetic.

## Key invariants

The canonical relationships are enforced **in the database** — CHECK constraints,
composite foreign keys, partial unique indexes and triggers — not only in Zod or
TypeScript:

- **Single canonical status** — a task's lifecycle status exists only on `tasks.status`;
  runs, suggestions, claims and verifications have their own orthogonal statuses. A
  CHECK refuses invalid statuses, and `suggested` is not a persistable task status.
- **Central transition validation** — every status change goes through
  `assertTransition` inside a `BEGIN IMMEDIATE` transaction with a compare-and-swap on
  `(status, version)`; guarded transitions (dependency blocking, the completion proof
  set) refuse when guard data is absent, so callers cannot bypass checks by omission.
- **One approved task per suggestion** — partial unique indexes on
  `tasks.suggestion_id` and `task_suggestions.approved_task_id`; approval is the only
  transactional materialisation path. Suggestion materialisation is DISABLED in this
  build at the canonical task-creation boundary: `addTask` refuses any task carrying a
  `suggestionId` before any write, and `approveSuggestion` refuses before its
  transaction (see the security model). Triggers make decided suggestions and
  task/suggestion/roadmap relationships immutable (no silent reassignment).
- **Same-project consistency** — composite foreign keys force a task's (and
  suggestion's) roadmap item into the same project, and verification/review rows to
  cite a run of the same task. Evidence triggers refuse references to records that
  don't exist or belong to another task.
- **Append-only history** — `agent_run_events`, `task_claims`, `evidence`,
  `discovery_observations`, `routing_checkpoints`, `usage_observations` and
  `execution_policy_decisions` reject tampering via SQLite triggers, not just
  convention. Run events carry a payload hash and optional idempotency key: identical
  redelivery is a no-op, conflicting replacement is an error.
- **Stable IDs** — prefix-typed UUIDs (`task_…`, `arun_…`) generated in one place
  (`src/domain/ids.ts`); roadmap rows are addressed by stable IDs from the source.
- **No hard-coded model names** — routing classes come from the user-editable capability
  registry; a new model release is a config edit, not a code change.
- **Billing safety (this build)** — paid provider execution is unavailable: `createRun`
  refuses every paid billing mode unconditionally and the router never returns a paid
  route — with only paid options remaining it checkpoints, approval or not. On the free
  path, a run's billing must equal the model's authoritatively observed billing and an
  unobserved (`unknown`) model is unroutable (`agent_runs_billing_matches_model`); DB
  triggers additionally refuse forged paid inserts. The full paid-approval authority
  (purpose scoping, SQLite-consumed one-use) is NOT yet enforced — it is milestone M2.
- **Completion (this build)** — automated task completion is unavailable: no service
  path reaches `completed`. The completion proof set remains a live, tested pure model
  (`evaluateCompletionProof`), and `tasks_completion_requires_proof` remains a DB
  backstop against direct writes; however completion criteria are still mutable, so the
  proof is not yet trustworthy end-to-end — immutable criteria are milestone M3.
- **Claims and fencing (this build)** — worker-owned downstream mutations are
  unavailable: nothing can acquire or exercise a work claim, fence-carrying transitions
  and claim-bound run creation refuse outright. The lease model (one active claim per
  task, immutable attempt history, crash-recovery sweep) stays DB-enforced and tested;
  comprehensive fencing of every downstream write is milestone M4.
- **One (disabled) execution boundary** — every spawn path funnels through the
  execution gateway, and in this build the gateway's `execute()` refuses
  unconditionally before any validation or spawn. Discovery is process-free: the
  gateway's only runnable discovery operation resolves names on PATH for reporting and
  never runs a binary (no `--version`, no `which` subprocess, no `execFile`/`spawn`).
  The trust/containment pipeline behind the gate (supervisor-controlled canonical
  registry, path-argument confinement, process-group containment) is retained as M1
  groundwork with known gaps — it is not a complete execution boundary
  (`docs/security-model.md`).

## CLI exit codes

`major` exits with stable, documented codes: `0` success, `1` unexpected error,
`2` usage/validation error, `3` entity not found, `4` policy refusal, `5` unsafe
environment (`major doctor` when the inspection/dry-run environment is unhealthy;
overnight/live execution is separately reported as UNAVAILABLE and never as safe).
`--json` output is a versioned envelope: `{ "schemaVersion": 1, "kind": …, "data": … }`.

## Deliberate deferrals (later tracks)

The five disabled capabilities and their definitions of done are recorded in
`docs/deferred-security-milestones.md`:

- **M1** trusted OS-isolated execution (re-enables live agent execution);
- **M2** authoritative provider and billing control (re-enables paid execution);
- **M3** immutable database completion proof (re-enables task completion);
- **M4** complete worker fencing (re-enables worker-owned mutations);
- **M5** crash-safe external roadmap application (re-enables roadmap writes, with the
  live Google Sheets adapter — contract + mock exist; the live implementation slots
  behind the same interface).

Beyond those: worktree lifecycle automation, verification orchestration, and the
review adjudication loop.

## Recorded follow-ups (from the independent PR #1 review, P2)

1. **Suggestion provenance referential integrity** — non-human suggestion provenance
   requires a non-null `source_ref`, but neither the service nor the database yet
   confirms the referenced entity exists and matches the declared `source_type` and
   project. Follow-up: validate each source type against its owning table (and
   project) inside the suggestion transaction, with cross-project and dangling-ref
   tests. (Provenance immutability, deduplication, transactional approval and
   rejected-scope suppression are already enforced.)
2. **Production-boundary and migration coverage** — roadmap coverage exercises the
   in-memory adapter (crash-window, duplicate-apply and reconciliation paths included);
   the live Sheets adapter still needs a contract test suite run against the same
   scenarios, and migrations need representative legacy-database fixtures beyond the
   current fresh/reopen and 0000+0001-prefix upgrade tests, before live execution is
   enabled.
