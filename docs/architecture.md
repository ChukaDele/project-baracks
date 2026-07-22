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
  domain/      lifecycle state machine, task/run services (pure + DB)
  db/          Drizzle schema (16 entities), client, migrations
  providers/   capability registry, provider contracts, exec engine, mock
  routing/     model-aware resource router (pure decision function)
  roadmap/     roadmap adapter contract, shared validation, Sheets mock
  config/      generic project adapter (zod), project persistence
  guidance/    instruction/skills registry loader (supersession-aware)
  security/    redaction, path containment, command policy
  logging/     redacting JSON logger
  doctor/      environment/prerequisite report
  cli/         commander wiring only — no business logic
```

Dependency direction: `cli → {doctor, routing, providers, domain, config} → db/security`.
The router and lifecycle machine are pure functions; everything effectful (DB, spawn) is
injected, which is what keeps the test suite hermetic.

## Key invariants

- **Single canonical status** — a task's lifecycle status exists only on `tasks.status`;
  runs, suggestions, and verifications have their own orthogonal statuses.
- **Central transition validation** — every status change goes through
  `assertTransition`; guarded transitions (dependency blocking, evidence gating) refuse
  when guard data is absent, so callers cannot bypass checks by omission.
- **Append-only history** — `agent_run_events` rejects UPDATE/DELETE via SQLite triggers,
  not just convention.
- **Stable IDs** — prefix-typed UUIDs (`task_…`, `arun_…`) generated in one place
  (`src/domain/ids.ts`); roadmap rows are addressed by stable IDs from the source.
- **No hard-coded model names** — routing classes come from the user-editable capability
  registry; a new model release is a config edit, not a code change.
- **Billing safety** — the router returns a `checkpoint` decision instead of ever
  selecting paid capacity without an explicit approval flag.

## Deliberate deferrals (later tracks)

- Live agent execution loop (`major run` currently requires `--dry-run`).
- Live Google Sheets adapter (contract + mock exist; live impl slots behind the same
  interface).
- Worktree lifecycle automation, verification orchestration, review adjudication loop.
- Persistence of discovery results into `agent_providers` / `agent_models` on `doctor`.
