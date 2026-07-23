# Provider and model routing

**In this build, provider `execute()` is unreachable**: live agent execution is an
unavailable capability, so every execution path refuses before any subprocess
(`src/security/capabilities.ts`). Discovery, probing, routing decisions and dry runs
are the runnable surface.

## Provider contracts

`src/providers/types.ts` defines the `ProviderAdapter` contract: discovery (executable,
version, models), safe probing, and — deferred to milestone M1 — non-interactive
execution with streamed structured events, cancellation, timeout, and resumable
sessions.

Implementations:

- **Claude Code** (`claude-code.ts`) — discovery/probing live; its execute() builds
  `claude -p … --output-format stream-json` argv but always refuses at the gateway.
  Auth detection is a best-effort heuristic (no non-interactive auth command exists).
- **Codex** (`codex.ts`) — discovery/probing live; execute() (`codex exec --json …`)
  likewise always refuses. Auth detected via `~/.codex/auth.json`.
- **Mock** (`mock.ts`) — scripted events/outcomes for tests and dry runs; never spawns.

The shared engine (`exec.ts`) is quarantined with the capability: it refuses before
any spawn. Its retained M1 machinery spawns without a shell, parses NDJSON into
events, enforces timeouts, supports cancellation, confines the working directory and
redacts stderr.

## Capability registry

`src/providers/registry.ts` classifies models via user-editable rules
(`~/.major/model-registry.json`, `$MAJOR_MODEL_REGISTRY` to relocate). Rules map regex
patterns to routing classes, EXPECTED billing modes, and prohibitions — new model names
never require code changes. Class-level aliases (`opus`, `sonnet`) are preferred over
versioned marketing names so the defaults survive releases.

Registry billing is a configuration expectation, never evidence: `registryModels`
always reports `billingMode: 'unknown'` (unroutable) with the rule's value exposed only
as `expectedBillingMode` for display. Neither the registry file nor the
`$MAJOR_MODEL_REGISTRY` environment variable can make a model spendable.

## The router

`route(request, providers)` in `src/routing/router.ts` is a pure function:

1. Derive the target class from purpose, complexity, risk, and repair history
   (see `guidance/model-routing.md` for the policy).
2. Walk the class ladder (`fable → opus → sonnet`, etc.) over models that are visible,
   authenticated, available, and not prohibited.
3. Reviews prefer Codex, then any provider that didn't produce the work; a same-provider
   review is allowed only as a last resort and records `independenceLoss`.
4. Outside reviews, Codex is skipped entirely (review reserve).
5. A model whose billing mode is `unknown` is **unroutable** — with or without paid
   approval.
6. **Paid capacity is never routed in this build**: paid provider execution is an
   unavailable capability, so when only paid options remain the router returns a
   `checkpoint` decision listing them for a human — with or without an
   `approvedPaidUsage` reference. `createRun` independently refuses every paid billing
   mode. Purpose-scoped, SQLite-consumed one-use paid approval is milestone M2.

Every `route` decision carries a human-readable `reason` that is persisted on the
`agent_runs` record along with billing mode and allowance state. The database enforces
free-path billing authority independently: `agent_runs_billing_known` refuses runs
with an unknown billing mode, and `agent_runs_paid_requires_approved_decision` refuses
forged paid inserts (drizzle/0004, 0006 — a backstop, not the full M2 authority).
Checkpoint decisions are persisted to the append-only `routing_checkpoints` table
(`recordRoutingCheckpoint`).

## Persisted discovery and probe backoff

Availability and billing state are never merely asserted in code. Every discovery is
persisted (`src/providers/discovery-store.ts`): current state on `agent_models`, plus an
append-only `discovery_observations` row carrying the observed state, its **source**
(`registry`/`cli`/`probe`/`run_outcome`/`human`), **confidence**
(`configured`/`inferred`/`observed`) and timestamp. `major doctor` and `major run
--dry-run` persist what they discover.

Billing authority is stricter than availability: discovery NEVER writes
`billing_mode`. New models persist as `unknown` (unroutable) and re-discovery preserves
whatever was authoritatively observed. The only path that sets a billing mode is
`recordBillingObservation`, restricted by type to the two authoritative sources — a
human attestation (`human`, confidence `configured`) or an observed run outcome
(`run_outcome`, confidence `observed`). Registry defaults, executable presence and
auth-file heuristics can never classify execution as subscription-included.

Exhaustion and rate limits observed from real runs are recorded with a `nextProbeAt`
backoff (defaults: 15 min rate-limited, 60 min exhausted). `shouldProbe` gates
re-probing, and an optimistic re-discover does not erase an observed exhaustion until
the window passes. `loadPersistedProviderInfos` builds routing inputs from this
persisted state. No environment variable can silently activate API billing: billing
modes come only from authoritative persisted observations, and the execution gateway
strips billing-related variables from every child environment (see
`docs/security-model.md`).
