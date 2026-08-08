# Major

**Major is the cross-project engineering harness.** It coordinates coding agents, reusable skills, project state, verification and cross-project learning for Bredge, client, personal and external software projects.

Major is provider-neutral. Ruflo is the planned orchestration/memory substrate; Claude Code, Codex, Google Antigravity and Cursor are worker pools.

## Prime directive

**Get to a credible MVP proof fast.**

For a new project or a large feature list, Major should:

1. identify the core user/business outcome;
2. reduce scope to P0 MVP / P1 next / P2 later;
3. test the biggest uncertainty in the fastest credible medium;
4. build the P0 value loop end to end;
5. keep progress demonstrable while backend/infrastructure catches up;
6. verify the real path;
7. expand from evidence, not from the original wish list by default.

Major should not build every requested feature fractionally or front-load enterprise hardening before the core workflow is proven.

## Operating model

```text
Goal / brief
    ↓
Major policy + project state + memory
    ↓
Ruflo orchestration / routing
    ↓
Claude | Codex | Antigravity | Cursor
    ↓
isolated worktrees / explicit ownership
    ↓
build → browser/runtime verify → repair
    ↓
objective evidence
    ↓
verified reusable learning
```

Normal substantive builds can use 4–6 useful parallel workers, with capacity up to 8 when work is genuinely independent. Small/local work contracts naturally.

## Core rules

Binding rules live in `guidance/instructions.registry.json` and cover:

- BLUF + simplified technical communication;
- risk-proportional security;
- proof-first MVP prioritisation;
- autonomy and recovery;
- legacy cleanup;
- UI competitor learning + component reuse;
- outcome-oriented task scope;
- model/provider routing;
- human-only authority gates;
- provider-neutral project-state synchronization.

External skills are subordinate to these Major rules.

## Skills

Major owns the canonical reusable skill registry in `guidance/skills.registry.json`.

- Internal skills live in `skills/internal/`.
- Emil Kowalski's complete current design/motion bundle is installed for UI projects.
- Approved Anthropic/OpenAI/graph skills are fetched by `scripts/install-major-skills.sh`.
- Skills are installed/available broadly but loaded into active context only when triggered.

## Memory

Human-reviewable policy and verified global lessons live in this repository. Runtime/vector memory is a derived retrieval layer, not the only source of truth.

Project-specific confidential facts stay in project namespaces. Only sanitized reusable lessons are promoted globally.

## Current Major 2.0 migration status

The **policy, skills and knowledge migration is active on `major-v2-harness`**. The old Major v1 runtime is still present underneath it and intentionally does not yet represent the target execution system.

Before Major 2.0 is production-ready we must:

1. integrate Ruflo;
2. implement/verify Claude, Codex, Antigravity and Cursor worker adapters;
3. enable bounded real execution and adaptive multi-agent worktrees;
4. verify memory/skill retrieval;
5. test Major against a real project;
6. remove the old disabled execution gates and other v1 legacy code;
7. run the stale-reference/CI/E2E cleanup gate.

See `docs/migrations/major-v2-legacy-receipt.md` for the explicit cleanup contract.

## Development

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Do not infer Major 2.0 runtime readiness merely because the v1 CLI builds. Completion is the migration receipt's end-to-end gate, not compilation alone.
