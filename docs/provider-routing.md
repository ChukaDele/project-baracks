# Provider and model routing

## Provider contracts

`src/providers/types.ts` defines the `ProviderAdapter` contract: discovery (executable,
version, models), safe probing, and non-interactive execution with streamed structured
events, cancellation, timeout, and resumable sessions.

Implementations:

- **Claude Code** (`claude-code.ts`) — executes `claude -p … --output-format stream-json`;
  session refs from `session_id` events; usage from `result` events. Auth detection is a
  best-effort heuristic (no non-interactive auth command exists).
- **Codex** (`codex.ts`) — executes `codex exec --json …` (resume via `codex exec resume`);
  auth detected via `~/.codex/auth.json`; usage from `token_count` events.
- **Mock** (`mock.ts`) — scripted events/outcomes for tests and dry runs; never spawns.

The shared engine (`exec.ts`) spawns without a shell, parses NDJSON into events, enforces
timeouts (SIGTERM then SIGKILL), supports cancellation, confines the working directory to
configured roots, redacts stderr, and runs provider-supplied rate-limit/exhaustion
detectors.

## Capability registry

`src/providers/registry.ts` classifies models via user-editable rules
(`~/.major/model-registry.json`, `$MAJOR_MODEL_REGISTRY` to relocate). Rules map regex
patterns to routing classes, billing modes, and prohibitions — new model names never
require code changes. Class-level aliases (`opus`, `sonnet`) are preferred over versioned
marketing names so the defaults survive releases.

## The router

`route(request, providers)` in `src/routing/router.ts` is a pure function:

1. Derive the target class from purpose, complexity, risk, and repair history
   (see `guidance/model-routing.md` for the policy).
2. Walk the class ladder (`fable → opus → sonnet`, etc.) over models that are visible,
   authenticated, available, and not prohibited.
3. Reviews prefer Codex, then any provider that didn't produce the work; a same-provider
   review is allowed only as a last resort and records `independenceLoss`.
4. Outside reviews, Codex is skipped entirely (review reserve).
5. Subscription-included capacity always beats paid capacity. Paid capacity is used only
   when the request carries explicit human approval; otherwise the router returns a
   `checkpoint` decision listing the paid options for a human to approve.

Every `route` decision carries a human-readable `reason` that is persisted on the
`agent_runs` record along with billing mode and allowance state.
