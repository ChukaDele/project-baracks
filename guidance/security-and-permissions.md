# Security and permissions rules

These rules bind Major itself and every agent it dispatches. They override all other
guidance except explicit human decisions, and a human decision to weaken them must be
recorded as a `security_exception` DecisionRequest.

## Credentials

- Never commit credentials, tokens, or key material. Credentials are referenced only by
  environment-variable name (e.g. `GOOGLE_APPLICATION_CREDENTIALS`) or file path outside
  the repository.
- All logs, run events, and CLI output pass through the redaction layer
  (`src/security/redact.ts`). Anything matching a secret pattern is replaced with
  `[REDACTED]` before it is written anywhere.
- `major doctor` reports the presence of credentials, never their contents.

## Subprocess containment

- Every external process passes through the execution gateway
  (`src/security/gateway.ts`); provider adapters never spawn independently.
- Allowed project roots are mandatory and non-empty; roots and working directories are
  canonicalised with realpath before the containment check, so symlinks and `..`
  traversal cannot escape a root.
- The gateway accepts only structured executable + argv values — never shell command
  strings — and provider CLIs are spawned without a shell, so prompts can never inject
  shell syntax. Invoking a shell with `-c` is itself prohibited.
- Child processes receive a sanitised environment allowlist. API keys, paid-credit
  toggles and billing-related variables are stripped unless a valid, verified
  DecisionRequest explicitly authorises named variables.
- Every execution-policy decision — allowed or refused — is recorded (redacted) in the
  append-only `execution_policy_decisions` table.

## Prohibited operations

Enforced at spawn time by the gateway's argv policy (`src/security/commands.ts`)
regardless of configuration:

- direct pushes to protected branches (default: `main`, `master`), in any argv
  spelling including refspecs (`HEAD:main`) — bare `git push` is refused because
  upstream tracking could target a protected branch;
- force pushes (`--force`, `-f`, `--force-with-lease`, `--force-if-includes`);
- destructive database commands (`DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`);
- recursive force deletion (`rm -rf` and all flag arrangements);
- access outside configured project roots.

The project's `allowedExecutables` allowlist is mandatory: anything not on it is
refused. Projects add further prohibitions via `prohibitedCommands` (regex patterns).

## No automatic promotion

- Major never merges, deploys, or marks roadmap items Done on its own authority. Those are
  approval categories that require a resolved DecisionRequest (see `human-approval.md`).
