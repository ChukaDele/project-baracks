# Major

Autonomous engineering supervisor for Surface Talent and future projects — planned to
plan engineering tasks against a human-owned roadmap, route work to agent CLIs
(Claude Code, Codex), monitor execution, and never merge, deploy, spend money, or mark
work Done without evidence and human approval.

**This build is a disabled architectural foundation: dry-run and inspection only.**
It contains the canonical guidance, the relational state model, the task lifecycle
and run ledger, provider discovery contracts, the model-aware resource router, the
roadmap adapter contract with dry-run proposals, and the `major` CLI. Secret-safe
durable event handling (recursive, fail-closed redaction before persistence) is
implemented and independently verified.

What this build can NOT do — five capabilities are unavailable, enforced by a
hard-coded gate (`src/security/capabilities.ts`) that no configuration, environment
variable or CLI flag can open:

- **no live agent execution** — every spawn path refuses before any subprocess, and
  discovery is process-free: it resolves names on PATH but never runs a binary (no
  `--version`, no `which` subprocess, no `execFile`/`spawn`), so executable
  availability is reported as UNVERIFIED;
- **no paid provider execution** — paid billing modes and paid routes refuse, even
  with an approved decision reference;
- **no autonomous task completion** — no code path reaches `completed`;
- **no worker-owned mutations** — nothing can acquire or exercise a work claim;
- **no external roadmap writes** — apply/reconcile refuse before touching any adapter.

Beyond the five, **suggestion approval is also disabled** in this dry-run / inspection
foundation: `major task approve` and the underlying `approveSuggestion` refuse before
any mutation (exit 4), so a suggestion can never be materialised into a task.

Each capability returns in its own follow-up milestone with its own independent
security review: see `docs/deferred-security-milestones.md`.

## Setup

```sh
corepack enable        # provides pnpm
pnpm install
pnpm major doctor      # check prerequisites and providers
```

## Commands

```sh
major doctor                       # environment, providers, models; overnight execution
                                   #   is reported UNAVAILABLE (disabled), never "safe"
major project add <config.json>   # register a project (see examples/)
major project list
major task add --project <name> --title <t> [--complexity routine|bounded|complex|architectural]
major task suggest --project <name> --title <t> [--rationale <r>]
major task approve <suggestionId> # DISABLED in this foundation: refuses with exit 4
                                   #   (approving a suggestion is not permitted)
major task reject <suggestionId>
major task list [--project <name>]
major task show <taskId>
major queue                        # tasks eligible to run next
major run --task <taskId> --dry-run [--purpose implementation|review|...]
```

During development run them as `pnpm major <command>`; `pnpm build` produces
`dist/cli/index.js` (the `major` bin). State lives in `~/.major/major.db`
(`MAJOR_DB_PATH` overrides).

Exit codes are stable: `0` success, `1` unexpected error, `2` usage error, `3` not
found, `4` policy refusal, `5` unsafe environment (doctor). `--json` flags emit a
versioned envelope (`{ "schemaVersion": 1, ... }`).

## Development

```sh
pnpm test         # vitest (hermetic: in-memory SQLite, no network, no live CLIs)
pnpm typecheck    # strict TypeScript
pnpm lint         # eslint (type-checked rules)
pnpm format       # prettier
```

## Documentation

- `docs/architecture.md` — stack decisions, layering, invariants, deferred tracks
- `docs/deferred-security-milestones.md` — the five disabled capabilities and their
  definitions of done
- `docs/task-lifecycle.md` — canonical statuses, guarded transitions
- `docs/provider-routing.md` — provider contracts, capability registry, router
- `docs/security-model.md` — redaction, the capability gate, command policy
- `docs/roadmap-sync.md` — proposal/dry-run/evidence flow
- `docs/surface-talent-integration.md` — registering Surface Talent
- `guidance/` — the binding rules (instruction precedence, security, task scope, model
  routing, human approval, roadmap sync) plus machine-readable registries
