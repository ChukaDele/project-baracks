# Security model

The binding rules live in `guidance/security-and-permissions.md`; this document describes
the enforcement mechanics.

## Redaction (`src/security/redact.ts`)

Pattern-based redaction for private key blocks, GitHub/Anthropic/OpenAI/AWS/Google/Slack
tokens, JWTs, bearer headers, and `key=value` secrets. Applied:

- to every structured log line (`src/logging/logger.ts`);
- to captured stderr tails from provider subprocesses (`src/providers/exec.ts`);
- to every `major doctor` check detail.

`redactValue` round-trips JSON so structured payloads stay parseable after redaction.

## The execution gateway (`src/security/gateway.ts`)

Every external process passes through one boundary: `ExecutionGateway`. Provider
adapters cannot spawn independently — they hold a gateway and ask it to `execute`
(streamed agent runs) or `probeSync` (fixed-form discovery probes such as `which x`,
`x --version`, `gh auth status`). Before any spawn the gateway:

1. **Canonicalises and contains paths** — allowed roots are mandatory and non-empty;
   roots and the working directory are resolved with `realpath` before the containment
   check, so symlinks that point outside a root and `..` traversal are refused
   (`assertWithinRootsCanonical`).
2. **Enforces the argv command policy** (`checkArgv`) — structured executable + argv
   only, never shell strings (`sh -c` is itself refused). The executable must be on the
   project's configured `allowedExecutables` allowlist (mandatory). Built-in
   prohibitions regardless of configuration: force pushes (any spelling, including
   `git -C dir push -f`), pushes to protected branches (including `HEAD:main` refspecs;
   bare `git push` is refused because upstream tracking could target a protected
   branch), destructive SQL (`DROP`/`TRUNCATE`), and recursive force deletion
   (`rm -rf` in all flag arrangements). Projects layer on `prohibitedCommands`
   regexes.
3. **Sanitises the environment** (`src/security/env.ts`) — children receive an
   allowlisted env subset, never the parent environment. API keys, paid-credit
   toggles and billing-related variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `CLAUDE_CODE_USE_BEDROCK`, AWS/Google credentials, and anything matching secret
   naming patterns) are stripped unless a valid, verified DecisionRequest explicitly
   authorises named variables — an unverifiable authorisation refuses the spawn.
4. **Records every policy decision** — allowed or refused — with redacted argv, the
   stripped/authorised env names and the reason, to the append-only
   `execution_policy_decisions` table (`dbDecisionRecorder`).

`ExecutionGateway.probeOnly()` exists for pre-project contexts (doctor): probes work,
`execute` always refuses and records the refusal.

## What Major will not do

- No automatic merge, no automatic deployment: both are human-approval categories.
- No automatic paid usage: the router checkpoints instead (see
  `docs/provider-routing.md`).
- No credential storage: configs carry env-var names, never values; `major doctor`
  reports presence only.
