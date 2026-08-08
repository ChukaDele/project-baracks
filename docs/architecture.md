# Major 2.0 architecture

Major is a **cross-project operating layer for building software and doing evidence-based knowledge work**. It is not a project-specific application and not a replacement for the models, coding agents or source tools underneath it.

## One kernel, two internal profiles

Major has one policy/memory/skill/routing kernel with two main internal operating profiles:

### Major Build

Used to make and ship software.

- proof-first P0 MVP delivery;
- 4–6 useful workers normally, up to 8 when parallelism shortens the critical path;
- isolated worktrees and explicit write ownership;
- code, browser QA, preview deployments, repair loops and objective runtime evidence;
- Ruflo swarm/workflow machinery where it earns its coordination cost.

### Major Knowledge

Used for research, strategy, synthesis, comparisons and decision work.

- define the decision and minimum credible evidence first;
- ingest named primary sources with the best connector/API/CLI/parser/browser/local tool;
- use light, standard or high-stakes research depth rather than a fixed swarm size;
- parallel researchers cover materially different angles;
- use an independent skeptic/reviewer when consequence or uncertainty warrants it;
- preserve source provenance and separate evidence from inference;
- stop when more research is unlikely to change the next decision.

These are profiles of the same Major kernel, not separate harnesses. They share policy, communication, skill format, model routing, memory governance, cost/capacity rules and learning.

## Layers

### 1. Human-reviewable policy

Canonical rules live in `guidance/` and are selected by `guidance/instructions.registry.json`.

They define the non-negotiable operating philosophy: proof-first MVP delivery, tool/source routing, autonomy, legacy cleanup, communication, proportional security, task scope, provider routing and project-state rules.

### 2. Reusable skills

- Major internal skills: `skills/internal/`
- external skills: installed through the canonical installer and locked to source commits
- trigger-based loading: installed does not mean injected into every context

Skills provide technique; Major guidance has higher authority.

### 3. Tool/capability router

Major should route a task to the best capability rather than expecting the current model to do everything.

Typical source/tool routes:

- GitHub → GitHub connector/API;
- Google files/mail/calendar → native Google connectors;
- Figma → Figma tooling;
- public static web → direct fetch/search;
- dynamic/authenticated web → GStack/browser when needed;
- YouTube → `yt-dlp` captions → auto-captions → audio → local MacWhisper `mw`;
- local audio/video → MacWhisper;
- PDF/document/spreadsheet → native parser/skill;
- reasoning/synthesis → dynamically selected model(s).

A failed first tool is not a failed task. `guidance/tool-routing-and-source-ingestion.md` defines fallback and primary-source integrity rules.

GStack is an optional subordinate browser capability pack, installed namespaced with its proactive routing disabled. It does not replace Major's router or policy.

### 4. Project adapter

Each managed project declares only the context Major needs: root/repo, goal, P0/P1/P2 backlog, verification commands, protected resources, preview/deployment configuration and optional external task/roadmap adapters.

Major does not force every project into one external PM tool or infrastructure stack.

### 5. Orchestration substrate

Ruflo is the planned substrate for:

- task/swarm coordination;
- shared/semantic memory retrieval;
- worktree-aware execution;
- long-running loops;
- browser/workflow support;
- usage/observability signals.

Major remains the policy/source-of-truth layer above Ruflo so Ruflo can be upgraded or replaced without rewriting project rules.

### 6. Worker adapters

Thin adapters invoke available coding/reasoning environments:

- Claude Code;
- Codex;
- Google Antigravity;
- Cursor Agent CLI.

Worker/model choice is dynamic. State includes authentication, availability, rate-limit/exhaustion, billing mode, capability and observed outcomes. Prefer subscription-included capacity; paid API/credit spend is an explicit authority boundary.

### 7. Execution and concurrency

For Build:

- normal substantive builds: typically 4–6 useful roles;
- capacity: up to 8 normal development workers;
- small/local tasks contract to 1–2;
- every concurrent writer gets an isolated worktree and explicit ownership;
- one integration owner resolves overlapping manifests/changes.

For Knowledge:

- light work uses one direct source/research pass;
- standard work uses 2–4 materially different research angles plus skeptic/synthesis where useful;
- high-stakes work can expand further when more independent evidence materially improves the decision;
- read-only research/review can share source state safely.

Parallelism is used to reduce uncertainty or shorten the critical path, not to duplicate the same reasoning blindly.

### 8. Verification and recovery

Completion depends on external evidence appropriate to the task: tests, exact commit, browser/runtime behavior, persisted state, provider response, faithful primary-source content/transcript, preview/deploy result or explicit human acceptance.

Repair/fallback loops are bounded. Two materially unchanged failed strategies trigger a different strategy/tool/model rather than indefinite repetition.

### 9. Memory and learning

Three distinct stores:

1. **Git/Markdown** — human-reviewable rules, skills and verified reusable lessons.
2. **Project/personal state** — project-specific decisions, architecture, research context, blockers and sensitive domain context.
3. **Ruflo/AgentDB/runtime database** — derived searchable index, task/run state, outcomes and retrieval support.

Only sanitized transferable lessons cross from project/personal memory into Major global memory. Secrets and client-specific/confidential state do not.

## Communication adapters

Major maintains one canonical communication contract (`guidance/communication-style.md`) and installs it into the global/user-rule mechanisms of Claude Code, Codex and Antigravity. Cursor receives it through Major-managed project instructions and its global User Rules.

## Delivery architecture

For software, the default sequence is:

**fastest credible proof → P0 vertical slice → real critical path → evidence → expand/harden**

For knowledge work, the equivalent is:

**decision → biggest uncertainty → minimum credible evidence → primary-source ingestion → analysis/skeptic → recommendation → act/learn**

Mocks/fixtures are allowed behind explicit replaceable boundaries when they create faster visible progress. They must never be represented as live.

## Product-runtime boundary

Major may build product-specific AI systems, but those shipped runtimes are not Major itself. Client/product runtimes should receive only the permissions, skills, memory and data needed for that product; they do not inherit Major Build's broad machine access or global memory.

## Legacy rule

Git history is the archive. After a successor path is proven, obsolete v1 code, docs, configuration, names and flags are deleted from the active tree unless a real current consumer requires a temporary compatibility shim.

## Migration status

This document describes the target Major 2.0 architecture. The current branch still contains portions of the Major v1 runtime while Ruflo-backed execution/provider adapters are implemented. The migration is incomplete until the cleanup gate in `docs/migrations/major-v2-legacy-receipt.md` passes.
