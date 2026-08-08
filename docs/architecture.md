# Major 2.0 architecture

Major is a **cross-project engineering operating layer**, not a project-specific application and not a replacement for the coding agents themselves.

## Layers

### 1. Human-reviewable policy

Canonical rules live in `guidance/` and are selected by `guidance/instructions.registry.json`.

They define the non-negotiable operating philosophy: proof-first MVP delivery, autonomy, legacy cleanup, communication, proportional security, task scope, provider routing and project-state rules.

### 2. Reusable skills

- Major internal skills: `skills/internal/`
- external skills: installed through the canonical installer and locked to source commits
- trigger-based loading: installed does not mean injected into every context

Skills provide technique; Major guidance has higher authority.

### 3. Project adapter

Each managed project declares only the context Major needs: root/repo, goal, P0/P1/P2 backlog, verification commands, protected resources, preview/deployment configuration and optional external task/roadmap adapters.

Major does not force every project into one external PM tool or infrastructure stack.

### 4. Orchestration substrate

Ruflo is the planned substrate for:

- task/swam coordination;
- shared/semantic memory retrieval;
- worktree-aware execution;
- long-running loops;
- browser/workflow support;
- usage/observability signals.

Major remains the policy/source-of-truth layer above Ruflo so Ruflo can be upgraded or replaced without rewriting project rules.

### 5. Worker adapters

Thin adapters invoke available coding environments:

- Claude Code;
- Codex;
- Google Antigravity;
- Cursor Agent CLI.

Worker/model choice is dynamic. State includes authentication, availability, rate-limit/exhaustion, billing mode, capability and observed outcomes. Prefer subscription-included capacity; paid API/credit spend is an explicit authority boundary.

### 6. Execution and concurrency

- normal substantive builds: typically 4–6 useful roles;
- capacity: up to 8 normal development workers;
- small/local tasks contract to 1–2;
- every concurrent writer gets an isolated worktree and explicit ownership;
- read-only research/review can share state safely;
- one integration owner resolves overlapping manifests/changes.

Parallelism is used to shorten the critical path, not to duplicate the same reasoning blindly.

### 7. Verification and recovery

Completion depends on external evidence appropriate to the task: tests, exact commit, browser/runtime behavior, persisted state, provider response, preview/deploy result or explicit human acceptance.

Repair loops are bounded. Two materially unchanged failed strategies trigger a different strategy/tool/model rather than indefinite repetition.

### 8. Memory and learning

Three distinct stores:

1. **Git/Markdown** — human-reviewable rules, skills and verified reusable lessons.
2. **Project state** — project-specific decisions, architecture, blockers and sensitive domain context.
3. **Ruflo/AgentDB/runtime database** — derived searchable index, task/run state, outcomes and retrieval support.

Only sanitized transferable lessons cross from project memory into Major global memory. Secrets and client-specific/confidential state do not.

## Communication adapters

Major maintains one canonical communication contract (`guidance/communication-style.md`) and installs it into the global/user-rule mechanisms of Claude Code, Codex and Antigravity. Cursor receives it through Major-managed project instructions and its global User Rules.

## Delivery architecture

The default product sequence is not horizontal infrastructure-first development. It is:

**fastest credible proof → P0 vertical slice → real critical path → evidence → expand/harden**

Mocks/fixtures are allowed behind explicit replaceable boundaries when they create faster visible progress. They must never be represented as live.

## Legacy rule

Git history is the archive. After a successor path is proven, obsolete v1 code, docs, configuration, names and flags are deleted from the active tree unless a real current consumer requires a temporary compatibility shim.

## Migration status

This document describes the target Major 2.0 architecture. The current branch still contains portions of the Major v1 runtime while Ruflo-backed execution/provider adapters are implemented. The migration is incomplete until the cleanup gate in `docs/migrations/major-v2-legacy-receipt.md` passes.