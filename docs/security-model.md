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

## Containment (`src/security/paths.ts`)

`assertWithinRoots` resolves the target and requires it to fall inside a configured
project root; the exec engine calls it before spawning when roots are configured.
Provider CLIs are spawned with `shell: false` and argv arrays — no shell interpolation
surface.

## Command policy (`src/security/commands.ts`)

Built-in prohibitions (always on): force pushes, direct pushes to protected branches,
destructive SQL (`DROP`/`TRUNCATE`), recursive force deletion. Projects layer on
`prohibitedCommands` regexes and — preferred — an `allowedExecutables` allowlist that
refuses anything not explicitly permitted.

## What Major will not do

- No automatic merge, no automatic deployment: both are human-approval categories.
- No automatic paid usage: the router checkpoints instead (see
  `docs/provider-routing.md`).
- No credential storage: configs carry env-var names, never values; `major doctor`
  reports presence only.
