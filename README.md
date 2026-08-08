# Major

**Major is the cross-project operating harness for building software and doing evidence-based knowledge work.** It coordinates coding/reasoning agents, native tools, reusable skills, project state, verification and cross-project learning for Bredge, client, personal and external work.

Major is provider-neutral. Ruflo is the planned orchestration/memory substrate; Claude Code, Codex, Google Antigravity and Cursor are worker pools. Native connectors, CLIs and local tools remain first-class capabilities rather than forcing every task through a model.

## Prime directive

**Get to a credible proof fast.**

For software:

1. identify the core user/business outcome;
2. reduce scope to P0 MVP / P1 next / P2 later;
3. test the biggest uncertainty in the fastest credible medium;
4. build the P0 value loop end to end;
5. keep progress demonstrable while backend/infrastructure catches up;
6. verify the real path;
7. expand from evidence.

For knowledge work, use the equivalent rule: **minimum credible evidence for the next good decision**.

## One kernel, two profiles

### Major Build

Software workshop: aggressive safe autonomy, worktrees, multi-agent implementation, browser QA, previews, repair loops and runtime evidence. Normal substantive builds can use 4–6 useful parallel workers, up to 8 when work is genuinely independent.

### Major Knowledge

Research/strategy/synthesis: primary-source ingestion, tool routing, materially different research angles, independent skeptic review when justified, source provenance and decision-focused synthesis.

These are profiles of the same Major kernel, not separate harnesses.

## Tool/capability router

Major should use the right tool for each task:

```text
GitHub → GitHub connector/API
Google files/mail/calendar → native Google connectors
Figma → Figma tooling
public static web → direct fetch/search
JS-heavy/authenticated web → browser/GStack when needed
YouTube → yt-dlp captions → auto-captions → audio → local MacWhisper mw
local audio/video → MacWhisper
PDF/document/spreadsheet → native parser/skill
reasoning/synthesis → routed model(s)
```

**A failed first tool is not a failed task.** Major follows materially different fallbacks before declaring a blocker.

If the user names a primary source, Major must obtain that source or a faithful transcript/content before claiming to analyze it. Search snippets or articles about the source are not silent substitutes.

## Machine knowledge tools

On the development Mac:

```sh
# Check existing capabilities
bash scripts/setup-major-knowledge-tools.sh check

# Install/update yt-dlp + namespaced GStack where needed.
# MacWhisper is expected to exist separately and is never duplicated.
bash scripts/setup-major-knowledge-tools.sh install

# Install compact Major rules into Claude Code, Codex and Antigravity.
# The same text is copied to the clipboard for Cursor global User Rules.
bash scripts/install-major-global-rules.sh
```

YouTube ingestion can then use:

```sh
bash scripts/major-ingest-youtube.sh 'https://www.youtube.com/watch?v=...'
```

The script prefers YouTube captions/auto-captions. When they are unavailable it downloads audio and transcribes locally through MacWhisper `mw`.

GStack is installed as a **namespaced subordinate capability pack** with its proactive routing and telemetry disabled. Major remains the router/policy authority.

## Core rules

Binding rules live in `guidance/instructions.registry.json` and cover:

- BLUF + simplified technical communication;
- tool routing, fallback and primary-source integrity;
- risk-proportional security;
- proof-first MVP prioritisation;
- autonomy and recovery;
- legacy cleanup;
- UI competitor learning + component reuse;
- outcome-oriented task scope;
- model/provider routing;
- human-only authority gates;
- provider-neutral project-state synchronization.

External skills and capability packs are subordinate to these Major rules.

## Skills

Major owns the canonical reusable skill registry in `guidance/skills.registry.json`.

- Internal skills live in `skills/internal/`, including `source-ingestion` and `knowledge-work`.
- Emil Kowalski's complete current design/motion bundle is installed for UI projects.
- Approved Anthropic/OpenAI/graph skills are fetched by `scripts/install-major-skills.sh`.
- Skills are installed/available broadly but loaded into active context only when triggered.
- `knowledge` is a first-class Major profile alongside `core`, `web-ui`, `exploratory` and `full`.

## Memory

Human-reviewable policy and verified global lessons live in this repository. Runtime/vector memory is a derived retrieval layer, not the only source of truth.

Project/personal confidential facts stay in their own namespaces. Only sanitized reusable lessons are promoted globally.

## Current Major 2.0 migration status

The policy, skills, knowledge/tool routing and bootstrap layers are being migrated first. The old Major v1 runtime still exists underneath and intentionally does not yet represent the target execution system.

Before Major 2.0 is runtime-ready we must:

1. integrate Ruflo;
2. implement/verify Claude, Codex, Antigravity and Cursor worker adapters;
3. enable bounded real execution and adaptive multi-agent worktrees;
4. verify memory/skill retrieval;
5. test Major Build and Major Knowledge against real tasks;
6. remove the old disabled execution gates and other v1 legacy code;
7. run the stale-reference/CI/E2E cleanup gate.

See `docs/migrations/major-v2-legacy-receipt.md` for the explicit cleanup contract.

## Development

```sh
corepack enable
pnpm install
pnpm validate:major
pnpm test
pnpm typecheck
pnpm lint
```

Do not infer Major 2.0 runtime readiness merely because the v1 CLI builds. Completion is the migration receipt's end-to-end gate, not compilation alone.
