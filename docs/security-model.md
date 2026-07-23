# Security model

The binding rules live in `guidance/security-and-permissions.md`; this document describes
the enforcement mechanics of THIS build.

## The capability gate (`src/security/capabilities.ts`)

This build's primary enforcement is subtraction: five capabilities are unavailable —
live agent execution, paid provider execution, automated task completion, worker-owned
downstream mutations, and external roadmap application. Each quarantined entry point
(`gateway.execute`, `executeStreaming`, paid/claim-bound `createRun`, the `completed`
transition and fenced transitions, claim operations, `applyRoadmapUpdate`/
`reconcileRoadmapApplies`) refuses unconditionally with `CapabilityUnavailableError`
before any side effect. The gate is a frozen code constant: no configuration file,
environment variable, database row, CLI flag or constructor option is consulted, so
nothing short of a reviewed code change can open it. `major doctor` REPORTS these
capabilities; the report is diagnostic and never part of enforcement. Definitions of
done for re-enabling each capability: `docs/deferred-security-milestones.md`.

What remains fully implemented and verified in this build: redaction (below), the
process-free discovery path (name resolution only), the argv command policy,
environment sanitisation, and the database invariants/backstops.

Beyond the five capabilities, **suggestion materialisation is also disabled** in this
dry-run / inspection-only foundation, enforced at the canonical task-creation mutation
boundary rather than only in the CLI:

- `addTask` — the exported production task-creation API — treats the caller's input
  as mutable and potentially accessor-backed: it snapshots the complete input into a
  frozen, module-owned object FIRST, reading every property (in particular
  `suggestionId`, the only suggestion-provenance field) exactly once. Validation runs
  against that immutable snapshot, and the identical snapshot is what persists — the
  insert never rereads the caller's object, re-invokes a getter or consults a Proxy
  trap again, so a stateful accessor cannot show the guard `undefined` and hand
  persistence a pending suggestion id. A snapshot carrying suggestion provenance is
  refused with `SuggestionApprovalUnavailableError` BEFORE any write (no transaction,
  no task insert, no suggestion change, no relationship/approval record). The raw
  insert that can persist suggestion provenance is module-private (`insertTask`),
  accepts only module-created snapshots, and is reachable only through
  `approveSuggestion`, so the exported surface offers no alternate materialisation
  route. The same single-read discipline covers the other conditionally gated
  boundaries (`createRun`'s paid/claim gates, `applyTransition`'s fence,
  `addSuggestion`'s dedup fingerprint); `tests/task-input-snapshot.test.ts` holds the
  adversarial stateful-getter and Proxy regressions, including read-at-most-once
  assertions.
- `approveSuggestion` refuses before opening its transaction, and `major task approve`
  routes through it and exits with the policy-refusal code (4).

No environment variable, config file, database value or caller option can enable it.
Read-only suggestion inspection and the relational model are retained; ordinary
human-created tasks (no suggestion provenance) remain usable, as do roadmap-linked
tasks (a roadmap item is not suggestion provenance).

## Redaction (`src/security/redact.ts`)

Two layers, applied before anything durable is written:

1. **Structural (primary)** — `redactValue` walks the value BEFORE serialisation and
   replaces the COMPLETE value under any sensitive key name (`password`, `token`,
   `credentials`, `auth`, `api_key`, …), whatever its shape: nested objects, arrays and
   multi-part strings vanish whole, so no fragment can survive. Redaction failures
   (e.g. unserialisable values) fail closed: the payload is withheld, never persisted
   raw.
2. **Pattern-based (secondary)** — for free text: private key blocks,
   GitHub/Anthropic/OpenAI/AWS/Google/Slack tokens, JWTs, bearer headers, and
   `key=value` secrets (including env-style names like `AWS_SECRET_ACCESS_KEY` and
   quoted multi-word values; quoting is preserved so JSON text stays parseable).

Applied:

- to every run-event payload before it reaches `agent_run_events`
  (`appendRunEvent` — provider stdout, stderr, errors and structured objects);
- to every structured log line (`src/logging/logger.ts`);
- to captured stderr tails from provider subprocesses (`src/providers/exec.ts`);
- to verification-run output summaries and usage observations;
- to every `major doctor` check detail.

## The execution gateway (`src/security/gateway.ts`)

Every external process would pass through one boundary: `ExecutionGateway`. Provider
adapters cannot spawn independently — they hold a gateway and ask it to `execute`
(streamed agent runs, disabled) or, for discovery, `resolveExecutable` (a PROCESS-FREE
PATH lookup for reporting).

**In this build `execute()` is disabled**: it records a refusal and throws before any
validation or spawn, on every gateway including a fully configured one. And discovery
is now **resolution-only and process-free**: the gateway's only runnable discovery
operation, `resolveExecutable`, performs a filesystem PATH lookup and never runs a
binary — there is no `--version` probe, no `which` subprocess and no `execFile`/`spawn`
anywhere in the gateway. A path-qualified (environment/PATH-selected) executable
override is refused by `resolveExecutable`, so it cannot be turned into a spawn; a
resolved path is reported but is never treated as evidence a binary is genuine or
runnable. Executable availability is represented as UNVERIFIED until the trusted,
OS-isolated execution boundary of milestone M1.

The pipeline described below is retained as
**milestone M1 groundwork** — it is NOT a complete execution boundary. Independent
review found two gaps that M1 must close before live execution can be considered:
identity revalidation skips content hashing when file metadata appears unchanged, and
no OS-level filesystem/network isolation is enforced (process-group containment only).
With those caveats, the M1 groundwork the gateway will build on:

1. **Canonicalises and contains paths** — allowed roots are mandatory and non-empty;
   roots and the working directory are resolved with `realpath` before the containment
   check, so symlinks that point outside a root and `..` traversal are refused
   (`assertWithinRootsCanonical`).
2. **Binds the spawn to a trusted canonical installation with a revalidated identity**
   (`src/security/trusted-executables.ts`) — the allowlist name must have a registered
   trusted binding, established only by explicit pinning of a configured path or by PATH
   discovery **constrained to supervisor-controlled directories** (`allowedDirs`).
   Inherited PATH ordering never confers trust: a shadow binary in an unapproved
   directory is skipped however early it appears, and with no configured directories
   discovery trusts nothing. Reporting-only PATH resolution (used by discovery in this
   build) is process-free and confers no execution trust. Each binding captures a stable
   identity (device, inode, size, mtime
   and content hash); `verify()` re-checks it and refuses detected replacement or
   in-place mutation — with the KNOWN M1 GAP that content hashing is skipped when file
   metadata appears unchanged, so a preserved-metadata mutation is not yet caught. A
   path-qualified request must `realpath`-resolve to the trusted canonical identity (no
   same-basename shadow). What would spawn is always the trusted path — never the
   caller's string. An ESLint boundary rule keeps `child_process` unreachable outside
   the gateway and its spawner.
3. **Confines path-bearing arguments** — absolute path arguments and the values of
   directory/file flags (`-C`, `--work-tree`, `--git-dir`, `--output`, …) must resolve
   inside the allowed roots, so a trusted binary cannot be aimed at the filesystem
   outside them.
4. **Enforces the argv command policy** (`checkArgv`) — structured executable + argv
   only, never shell strings (`sh -c` is itself refused). The executable must be on the
   project's configured `allowedExecutables` allowlist (mandatory). Built-in
   prohibitions regardless of configuration: force pushes (any spelling, including
   `git -C dir push -f`), pushes to protected branches (including `HEAD:main` refspecs;
   bare `git push` is refused because upstream tracking could target a protected
   branch), destructive SQL (`DROP`/`TRUNCATE`), and recursive force deletion
   (`rm -rf` in all flag arrangements). Projects layer on `prohibitedCommands`
   regexes.
5. **Sanitises the environment** (`src/security/env.ts`) — children receive an
   allowlisted env subset, never the parent environment. API keys, paid-credit
   toggles and billing-related variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `CLAUDE_CODE_USE_BEDROCK`, AWS/Google credentials, and anything matching secret
   naming patterns) are stripped unless a valid, verified DecisionRequest explicitly
   authorises named variables — an unverifiable authorisation refuses the spawn.
6. **Applies process-tree containment and records the decision** — the spawn runs as a
   process-group leader so the ENTIRE descendant tree (not only Major's direct child) is
   terminated together on cancel/timeout; and every policy decision — allowed or refused
   — is written with redacted argv, the stripped/authorised env names and the reason to
   the append-only `execution_policy_decisions` table (`dbDecisionRecorder`).

`ExecutionGateway.probeOnly()` exists for pre-project contexts (doctor): process-free
name resolution works, `execute` always refuses and records the refusal — in this build
EVERY gateway behaves that way for `execute`, via the capability gate.

**What is and is not guaranteed:** in this build the execution guarantee is that no
process is created at all — neither an agent run nor a discovery probe spawns anything.
The retained pipeline is not an OS-level filesystem or
network sandbox — a spawned agent process and its descendants would not be
kernel-jailed to the allowed roots — and its identity revalidation has the
preserved-metadata gap above. Both must be closed, and independently reviewed, before
milestone M1 removes the gate (`docs/deferred-security-milestones.md`). The doctor's
`liveExecutionReady` field is a diagnostic report of OS containment support, never an
enforcement input.

## What Major will not do

- No process creation of any kind in this build: every agent spawn path refuses
  (capability gate), and discovery is process-free — it resolves names on PATH but
  never runs a binary (no `--version`, no `which` subprocess, no `execFile`/`spawn`).
- No paid usage of any kind in this build: paid routes checkpoint and paid run
  records are refused, approval or not (see `docs/provider-routing.md`).
- No suggestion materialisation in this build: `addTask` refuses any task carrying
  suggestion provenance, and `approveSuggestion` / `major task approve` refuse before
  any mutation; a pending suggestion cannot be turned into a task through any exported
  path.
- No task ever reaches `completed`, no work claim can be taken, and no external
  roadmap write can occur in this build (capability gate).
- No automatic merge, no automatic deployment: both are human-approval categories.
- No credential storage: configs carry env-var names, never values; `major doctor`
  reports presence only.
