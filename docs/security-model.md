# Security model

The binding rules live in `guidance/security-and-permissions.md`; this document describes
the enforcement mechanics.

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

Every external process passes through one boundary: `ExecutionGateway`. Provider
adapters cannot spawn independently — they hold a gateway and ask it to `execute`
(streamed agent runs) or `probeSync` (fixed-form discovery probes such as `which x`,
`x --version`, `gh auth status`). Before any spawn the gateway:

1. **Canonicalises and contains paths** — allowed roots are mandatory and non-empty;
   roots and the working directory are resolved with `realpath` before the containment
   check, so symlinks that point outside a root and `..` traversal are refused
   (`assertWithinRootsCanonical`).
2. **Binds the spawn to a trusted canonical installation**
   (`src/security/trusted-executables.ts`) — the allowlist name must have a registered
   trusted binding, established only by explicit pinning of a configured path or by
   supervisor-side PATH discovery (the gateway resolves `which` itself over the
   sanitised PATH; it never spawns `which`). A path-qualified request must
   `realpath`-resolve to the trusted canonical identity, so a same-basename shadow
   binary at any other location is refused, and what actually spawns is always the
   trusted path — never the caller's string. An ESLint boundary rule keeps
   `child_process` unreachable outside the gateway and its streaming spawner.
3. **Enforces the argv command policy** (`checkArgv`) — structured executable + argv
   only, never shell strings (`sh -c` is itself refused). The executable must be on the
   project's configured `allowedExecutables` allowlist (mandatory). Built-in
   prohibitions regardless of configuration: force pushes (any spelling, including
   `git -C dir push -f`), pushes to protected branches (including `HEAD:main` refspecs;
   bare `git push` is refused because upstream tracking could target a protected
   branch), destructive SQL (`DROP`/`TRUNCATE`), and recursive force deletion
   (`rm -rf` in all flag arrangements). Projects layer on `prohibitedCommands`
   regexes.
4. **Sanitises the environment** (`src/security/env.ts`) — children receive an
   allowlisted env subset, never the parent environment. API keys, paid-credit
   toggles and billing-related variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `CLAUDE_CODE_USE_BEDROCK`, AWS/Google credentials, and anything matching secret
   naming patterns) are stripped unless a valid, verified DecisionRequest explicitly
   authorises named variables — an unverifiable authorisation refuses the spawn.
5. **Records every policy decision** — allowed or refused — with redacted argv, the
   stripped/authorised env names and the reason, to the append-only
   `execution_policy_decisions` table (`dbDecisionRecorder`).

`ExecutionGateway.probeOnly()` exists for pre-project contexts (doctor): probes work,
`execute` always refuses and records the refusal.

**Containment guarantee, stated precisely:** the gateway guarantees WHICH binary runs
(trusted canonical identity), WHERE it starts (realpath-checked working directory),
WITH WHAT environment (allowlisted, credential-stripped) and WITH WHAT arguments
(policy-checked argv, no shell). It is not an OS-level filesystem sandbox: a spawned
agent process is not kernel-jailed to the allowed roots. That is exactly why only
trusted canonical executables may be spawned at all, and why kernel-level sandboxing
remains a precondition track before live execution is enabled.

## What Major will not do

- No automatic merge, no automatic deployment: both are human-approval categories.
- No automatic paid usage: the router checkpoints instead (see
  `docs/provider-routing.md`).
- No credential storage: configs carry env-var names, never values; `major doctor`
  reports presence only.
