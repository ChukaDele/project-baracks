# Major

**Major is a thin cross-project control plane for software delivery and evidence-based knowledge work.** It owns durable goals, project trust, tool/worker routing, evidence, stop controls and reusable learning. It should not become a giant hard-coded workflow factory.

## Prime directive

**Get to a credible end-to-end proof fast.**

For software:

1. identify the core user/business outcome;
2. reduce broad scope to P0 MVP / P1 next / P2 later;
3. test the biggest uncertainty in the fastest credible medium;
4. build the P0 value loop end to end;
5. keep progress demonstrable;
6. verify the real path;
7. keep working the highest-impact missing P0 node until the goal is true or a genuine owner gate remains.

For knowledge work: **minimum credible evidence for the next good decision**.

## Thin kernel, fat skills

Permanent Major code should stay focused on deterministic control-plane concerns:

- durable goal/project state;
- project class and trust;
- worker/tool availability;
- worktree/process lifecycle;
- kill switch;
- evidence/audit boundaries;
- owner gates;
- provider/cost restrictions.

Reusable procedure belongs in tested skills. Repeated deterministic mechanics can be composed at runtime with `tools-as-code`. A successful novel procedure becomes a reusable skill only after it works, via `skillify`.

```text
user goal
  ↓
Major kernel
  ↓
skill resolver
  ↓
relevant skill packs
  ↓
agent
  ↓
reason | native tool | Tools-as-Code | dynamic worker graph
  ↓
evidence / independent grade
  ↓
reusable success? → skillify
```

## Always present ≠ always autonomous

Major's communication/routing/project context should be present across supported agent tools, but execution authority is **project-scoped**.

Project classes:

- `unknown`
- `workshop`
- `client`
- `knowledge`

Trust levels:

- `observe` — no delegated execution;
- `assist` — visible foreground pilot, max 3 useful workers;
- `build` — validated build mode, max 6 useful workers;
- `unattended` — max 8 useful workers and background continuation.

Unknown projects default to observe. Client/candidate/PII projects stay isolated until explicitly classified/promoted.

Trust beyond assist requires a passing independent grade.

## Pilot deployment

Install the v0.4 pilot runtime:

```sh
bash scripts/install-major-runtime.sh
```

This installs:

- global `major` CLI;
- global Major rules for Claude/Codex/Cursor/Antigravity;
- deterministic Claude `SessionStart` attach;
- durable goal/policy state;
- scoped worker adapters and execution gateway.

It **does not** auto-start a Mac login daemon and **does not** attach Ruflo globally.

Recommended first classification:

```sh
major project configure jss-tool --class workshop --trust assist
major project configure surface-talent --class client --trust observe
```

Run the first real JSS pilot visibly:

```sh
major run jss-tool \
  --goal "Ship the smallest credible end-to-end JSS MVP" \
  --foreground
```

Emergency stop:

```sh
major stop
```

Resume after inspection:

```sh
major start
```

## Built, validated, ready

Major uses these terms deliberately:

- **BUILT** — implementation exists.
- **VALIDATED** — relevant deterministic checks plus an independent grader support the claim.
- **READY** — a representative real-world outcome succeeded under the intended trust profile.

Builder-authored CI is useful but does not make Major ready.

The first readiness gate is JSS in `workshop/assist`: Major must make correct real product progress in a visible foreground cycle, respect the 3-worker ceiling, persist state, respect owner gates, and leave objective evidence. A different provider then grades the exact result before Major is promoted to `build`.

Surface Talent remains `client/observe` during this pilot.

## One kernel, two profiles

### Major Build

Software delivery: MVP planning, implementation, worktrees, browser QA, previews, repair loops, CI recovery and objective runtime evidence.

### Major Knowledge

Research/strategy/synthesis: primary-source ingestion, source-specific tool routing, Tools-as-Code for repeated retrieval mechanics, materially different research angles, skeptic review where justified and decision-focused synthesis.

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

**A failed first tool is not a failed task.**

## Ruflo

Ruflo is optional subordinate infrastructure, not Major's source of truth and not a global pilot dependency. It can be enabled later for trusted workshop projects if real runs show that its swarm/memory primitives improve outcomes enough to justify coordination and blast-radius cost.

## Rules, skills and memory

- binding policy: `guidance/instructions.registry.json`;
- global worker rules: `guidance/global-worker-rules.md`;
- recurring skill registry: `guidance/skills.registry.json`;
- internal skills: `skills/internal/`;
- human-reviewable reusable knowledge: Git/Markdown;
- project/private knowledge: project-local namespaces;
- client/candidate/PII data never enters global Major/Ruflo memory.

## Runtime migration boundary

Major v0.4 is **built**, not yet **ready**. The v1 runtime remains temporarily as a migration reference until the JSS assist pilot and independent grade pass. Then obsolete v1 code/tests/docs are removed under the legacy-cleanup protocol.

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
