# Major

Autonomous engineering supervisor for Surface Talent and future projects: Major plans
engineering tasks against a human-owned roadmap, routes each piece of work to the right
agent CLI and model class (Claude Code, Codex), monitors execution, and never merges,
deploys, spends money, or marks work Done without evidence and human approval.

This repository contains the tested vertical foundation: canonical guidance, the
relational state model, the task lifecycle, provider contracts, the model-aware resource
router, the roadmap adapter contract, and the `major` CLI. Live agent execution and live
Google Sheets writes are deliberately later tracks.

## Setup

```sh
corepack enable        # provides pnpm
pnpm install
pnpm major doctor      # check prerequisites and providers
```

## Commands

```sh
major doctor                       # environment, providers, models, overnight safety
major project add <config.json>   # register a project (see examples/)
major project list
major task add --project <name> --title <t> [--complexity routine|bounded|complex|architectural]
major task suggest --project <name> --title <t> [--rationale <r>]
major task approve <suggestionId> # suggestion -> draft task
major task reject <suggestionId>
major task list [--project <name>]
major task show <taskId>
major queue                        # tasks eligible to run next
major run --task <taskId> --dry-run [--purpose implementation|review|...]
```

During development run them as `pnpm major <command>`; `pnpm build` produces
`dist/cli/index.js` (the `major` bin). State lives in `~/.major/major.db`
(`MAJOR_DB_PATH` overrides).

## Development

```sh
pnpm test         # vitest (hermetic: in-memory SQLite, no network, no live CLIs)
pnpm typecheck    # strict TypeScript
pnpm lint         # eslint (type-checked rules)
pnpm format       # prettier
```

## Documentation

- `docs/architecture.md` — stack decisions, layering, invariants, deferred tracks
- `docs/task-lifecycle.md` — canonical statuses, guarded transitions
- `docs/provider-routing.md` — provider contracts, capability registry, router
- `docs/security-model.md` — redaction, containment, command policy
- `docs/roadmap-sync.md` — proposal/dry-run/evidence flow
- `docs/surface-talent-integration.md` — registering Surface Talent
- `guidance/` — the binding rules (instruction precedence, security, task scope, model
  routing, human approval, roadmap sync) plus machine-readable registries
