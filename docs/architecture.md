# Architecture

Major is an autonomous engineering supervisor: it plans, dispatches, monitors, and
verifies work performed by agent CLIs (Claude Code, Codex) across configured projects,
starting with Surface Talent.

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
  transactional materialisation path, and triggers make decided suggestions and
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
- **Billing safety** — unknown billing is unroutable; paid routes require an approved
  `paid_usage` DecisionRequest (a DB CHECK refuses paid runs without one); otherwise
  the router checkpoints, and the checkpoint is persisted.
- **One execution boundary** — every external process passes through the execution
  gateway (`docs/security-model.md`).

## CLI exit codes

`major` exits with stable, documented codes: `0` success, `1` unexpected error,
`2` usage/validation error, `3` entity not found, `4` policy refusal, `5` unsafe
environment (`major doctor` when overnight execution is not safe). `--json` output is a
versioned envelope: `{ "schemaVersion": 1, "kind": …, "data": … }`.

## Deliberate deferrals (later tracks)

- Live agent execution loop (`major run` currently requires `--dry-run` and exits 4
  otherwise).
- Live Google Sheets adapter (contract + mock exist; live impl slots behind the same
  interface).
- Worktree lifecycle automation, verification orchestration, review adjudication loop.
