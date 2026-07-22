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

- Subprocesses run only inside configured project roots
  (`src/security/paths.ts#assertWithinRoots`). A cwd outside every registered root is a
  hard error.
- Provider CLIs are spawned without a shell; prompts are passed as argv entries and can
  never inject shell syntax.

## Prohibited operations

Enforced by `src/security/commands.ts` regardless of configuration:

- direct pushes to protected branches (default: `main`, `master`);
- force pushes (`--force`, `-f`, `--force-with-lease`);
- destructive database commands (`DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`);
- recursive force deletion (`rm -rf` and variants).

Projects add their own prohibitions via `prohibitedCommands` (regex patterns) and, in
preference to blocklists, an `allowedExecutables` allowlist: when an allowlist is present,
anything not on it is refused.

## No automatic promotion

- Major never merges, deploys, or marks roadmap items Done on its own authority. Those are
  approval categories that require a resolved DecisionRequest (see `human-approval.md`).
