# Major

**Major is the default cross-project supervisor for software delivery and evidence-based knowledge work.** It owns durable goals, routes work across agents/tools, keeps the critical path moving, verifies outcomes and carries reusable learning across projects.

Major is the coordination/policy layer. Ruflo is a swarm/memory substrate beneath it. Claude Code, Codex, Google Antigravity and Cursor are worker pools rather than separate operating systems.

## Prime directive

**Get to a credible end-to-end proof fast.**

For software:

1. identify the core user/business outcome;
2. reduce broad scope to P0 MVP / P1 next / P2 later;
3. test the biggest uncertainty in the fastest credible medium;
4. build the P0 value loop end to end;
5. keep progress demonstrable while supporting infrastructure catches up;
6. verify the real path;
7. keep working the highest-impact missing P0 node until the goal is true or a genuine owner gate remains.

For knowledge work, use the equivalent rule: **minimum credible evidence for the next good decision**.

## Major is the default state

The target behavior is not “remember to run Major.” Major is installed once and remains present:

- a persistent supervisor daemon starts at Mac login;
- Claude Code attaches on every startup/resume/clear/compact through a `SessionStart` hook;
- Codex, Cursor and Antigravity receive global Major instructions and attach before substantive work;
- Ruflo MCP is registered globally for the supported worker hosts;
- broad/multi-step requests become durable Major goals rather than isolated chats;
- small bounded requests may remain in the current agent session under Major rules.

Install the live runtime on the development Mac:

```sh
bash scripts/install-major-runtime.sh
```

After installation:

```sh
major status
major run jss-tool --goal "Ship the smallest credible end-to-end JSS MVP" --autonomous
major status jss-tool
```

The CLI state lives under `~/.major/`, including `supervisor-state.json` and daemon logs. Goals survive individual agent sessions and Mac restarts.

## Supervisor loop

```text
user outcome
   ↓
durable Major goal
   ↓
read current project truth
   ↓
choose current critical path / coordinator
   ↓
delegate Claude | Codex | Cursor | Antigravity
   ↓
worktrees for concurrent writers
   ↓
verify browser / tests / provider / persisted state / exact SHA
   ↓
what is the next missing P0 outcome?
   ↓
continue automatically
   ↓
done OR genuine owner-only gate
```

Normal substantive work uses **4–6 useful workers**, with capacity up to **8** when work is genuinely independent. Duplicate agents are not a goal.

## One kernel, two profiles

### Major Build

Software workshop: autonomous implementation, worktrees, browser QA, previews, repair loops, CI recovery and runtime evidence.

### Major Knowledge

Research/strategy/synthesis: primary-source ingestion, task-specific tool routing, materially different research angles, independent skeptic review when justified, source provenance and decision-focused synthesis.

These are profiles of one Major kernel, not separate harnesses.

## Tool/capability router

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

**A failed first tool is not a failed task.** If the user names a primary source, Major obtains that source or a faithful transcript/content before claiming to analyze it.

## Rules and skills

Binding operating rules live in `guidance/instructions.registry.json`. Cross-tool defaults live in `guidance/global-worker-rules.md`.

The recurring skill catalog lives in `guidance/skills.registry.json` and `docs/skills-catalog.md`:

- Major internal project/MVP/autonomy/QA/learning/tool-routing skills;
- the complete current Emil Kowalski design/motion bundle for UI projects;
- selected Anthropic/OpenAI/graph skills by profile/trigger;
- knowledge and exploratory profiles without injecting every specialist skill into every prompt.

External skills provide technique. Major policy has higher authority.

## Memory

Human-reviewable policy and verified reusable lessons live in Git. Project/private knowledge stays namespaced. Ruflo/AgentDB/runtime state is the searchable/operational layer, not the only source of truth.

## Runtime migration boundary

The new default supervisor runtime is the successor to Major v1's deliberately disabled execution foundation. The v1 code remains temporarily in the repository so we can compare behavior and keep existing tests while the successor is proven.

**Do not call Major fully complete merely because this branch builds.** The release gate is a real project:

1. install the runtime on the Mac;
2. start a JSS product-level autonomous goal once;
3. prove Major itself delegates, reroutes, continues and updates durable status without repeated user prompts;
4. prove restart/resume;
5. then delete the obsolete v1 disabled execution path and stale tests/code under the legacy-cleanup protocol;
6. validate Surface Talent as the second real project.

See `docs/migrations/major-v2-legacy-receipt.md`.

## Development

```sh
corepack enable
pnpm install
pnpm validate:major
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```
