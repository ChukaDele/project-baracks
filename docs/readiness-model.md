# Readiness model (v0.5.3)

This document replaces the earlier mental model where a single global `live-agent-execution`
capability boolean meant "every provider has passed release field validation." That conflated
two different concerns and made a single provider's problem (an expired Claude OAuth token, a
Cursor auth lapse) look like a defect in the Major release itself.

## The old model and why it was wrong

Before this change, `liveExecutionReady = isCapabilityAvailable('live-agent-execution') &&
containment.ready`. The capability flag's own reason text was "isolated provider runner has not
passed all provider and lifecycle field gates" — i.e. it stayed `false` until every provider had
been field-tested for the exact release SHA through a single-shot, Secure-Enclave-gated
validation lease (see `scripts/issue-secure-enclave-staged-validation-lease.sh` and
`src/security/staged-validation.ts`). One provider's field test failing (as Claude's did on this
exact release SHA, `8b33feafe11b8b5a4ebfd836b455f793a38bc22e`, due to an upstream ARM64 OAuth
issue) therefore left the *entire build* reporting `liveExecutionReady: false`, with no path back
except revoking and re-issuing that exact-SHA lease — a maintainer-only, biometrically-gated,
one-shot action.

## The new model

Three independent layers, computed in `src/doctor/readiness.ts`:

1. **Core platform safety** (`computeCoreReadiness`) — is the selected execution boundary
   sound: macOS Seatbelt containment for the normal host path, or filesystem/network/lifecycle
   isolation plus the credential broker and guest-user isolation for explicit Lima compatibility?
   This is what `live-agent-execution` now gates (see `src/security/capabilities.ts`) — a
   property of the *code and selected boundary*, not of any provider's auth state. The host
   boundary is inspected by `inspectMajorExecutionPath()`. The Lima boundary remains available
   only when `major execution select --path lima` is explicit.

2. **Per-provider health** (`computeProviderReadiness`) — one of `READY`, `AUTH_REQUIRED`,
   `RATE_LIMITED`, `EXHAUSTED`, `UNAVAILABLE`, `UNSUPPORTED_VERSION`, `NOT_CONFIGURED` per
   provider, computed independently. A provider being `AUTH_REQUIRED` or `EXHAUSTED` is a normal
   operating condition, not evidence the release is broken, and never changes another provider's
   state.

3. **Live execution readiness** (`computeLiveExecutionReadiness`) —
   `liveExecutionReady = coreReady && at least one provider is READY`. `multiProviderReady` is
   true only with more than one healthy provider (fallback capacity exists). `overnightExecution`
   remains a wholly separate, still-disabled signal (see `src/doctor/doctor.ts`) — this change
   does not touch unattended/background authority.

## Maintainer field validation vs. end-user setup

The Secure-Enclave-gated staged-validation lease system (`scripts/issue-secure-enclave-staged-validation-lease.sh`,
`scripts/stage-major-release-candidate.sh`, `scripts/validate-cli-provider-field.mjs`,
`scripts/validate-postmerge-release-fields.mjs`) is a **maintainer-only, pre-activation bootstrap**:
its purpose was to prove the isolated runner mechanism safe *before* `live-agent-execution` could
be turned on at all, without letting an agent self-authorize that activation (every lease requires
a live, biometric Secretive/Secure-Enclave signature tied to the exact release SHA).

Once `live-agent-execution` is active, `issueStagedValidationLease` refuses immediately
(`'staged validation is unavailable after supervised activation'`) — see the retirement test in
`tests/activated-capabilities.test.ts`. This is by design: normal execution now goes through the
supervised host path (`executeMajorCommand` → trusted CLI under macOS Seatbelt). Explicit Lima
compatibility still uses the same Major gateway and `LimaBackend`. The maintainer bootstrap has
done its job. Historical leases (including Claude's genuine `FAILED` attempt on this exact SHA)
remain forever in the append-only `validation_leases` table — never rewritten, never deleted
(`validation_leases_no_delete`/`validation_leases_terminal_immutable` triggers).

End users never see any of this. Ordinary friends run `major setup` / `major doctor`, authenticate
whichever providers they have, and get `liveExecutionReady: true` the moment core safety holds and
one provider is `READY` — no Secure Enclave key, no exact-SHA lease, no understanding of M1
required.

## Ongoing provider retry is a separate, already-existing system

The field-validation lease table is intentionally single-shot per exact (release SHA, provider)
pair — that is what makes a maintainer's "this release passed field validation" claim meaningful.
But *ordinary* provider health (an expired token, a quota reset, an account swap) needed a genuine
retry story, satisfied by machinery that already existed and needed no new schema:

- `src/providers/discovery-store.ts`'s `discoveryObservations` table is append-only
  (`discovery_observations_no_update`/`_no_delete` triggers) — every observation, pass or fail, is
  permanently recorded with its source and confidence.
- `agentModels.nextProbeAt` is a bounded backoff window (`shouldProbe`, `consumeModelRetry`)
  preventing hot-looping a genuinely down provider.
- `major provider probe <name>` (`src/providers/lifecycle-cli.ts`) is the new, minimal command for
  the exact "I switched Claude accounts, check again" workflow (see below). It is an *explicit,
  human-triggered* re-check, so it may — deliberately, via `persistProviderDiscovery`'s new
  `bypassBackoff` option — observe a materially changed auth state sooner than the passive backoff
  would otherwise allow. Automatic/background discovery never sets this flag.

No release SHA, no database edit, no field-validation lease is involved in ordinary provider
health changes — exactly matching the rule that a new source release should correspond to source
changes, not an OAuth token refreshing.

## Manual Claude account swap (supported workflow)

```
major provider probe claude-code       # → EXHAUSTED (or AUTH_REQUIRED)
# owner switches the active Claude login
major provider probe claude-code       # → READY
```

`major doctor` / `major setup` reflect the same state on their next run. No reinstall, no new
release SHA, no M1 reset, no database edit.

## Normal host-path operation

The normal path is intentionally smaller than the retired DSH/Lima workstation:

```text
Major policy and resource lease
→ trusted provider CLI
→ macOS Seatbelt host containment
→ compact Major run receipt
→ GBrain/project learning and repeated-evidence decisions
```

Use `major execution status --json` to inspect the selected path and its live
containment. Use `major execution select --path lima` only for an explicit
compatibility run. Host provider probes use the CLI's supported read-only status
surface. They do not copy credentials, start a login daemon or require a DSH
runtime.

The local run-insight store is sufficient for this migration. It preserves
append-only evidence, useful-work and infrastructure timing, worker/provider
performance, skills and evidence-qualified effects, failures, interventions,
quality, outcomes and recurrence. An optional Langfuse/OpenTelemetry exporter
can consume high-volume telemetry later. Exporter health must never block the
active objective or invalidate the durable Major receipt.

## Keychain logins on the host path (Claude Code, Cursor)

On macOS, Claude Code and the Cursor CLI keep their interactive login in the
Keychain (`Claude Code-credentials`, `cursor-access-token`). Major's Seatbelt
sandbox cannot read the Keychain, and Major never extracts a Keychain secret.
So a Mac where `claude auth status` says `loggedIn: true` still probes as
`AUTH_REQUIRED`. The probe detail now starts with `host-keychain-only:` and
names the fix.

The fix uses each provider's official headless credential. The owner creates
it with the provider's own tool and gives it to Major on stdin. It is never an
argument, never echoed and never logged.

Claude Code (subscription OAuth token, no API billing):

```bash
claude setup-token                                # sign in; it prints a long-lived token
pbpaste | major provider import-token claude-code # after you copy the token
pbcopy < /dev/null                                # clear the clipboard
```

`claude setup-token | major provider import-token claude-code` also works when
the sign-in can complete with stdout piped; Major picks the single
`sk-ant-oat…` word out of the output.

Cursor (User API Key from the Cursor dashboard, Integrations page):

```bash
pbpaste | major provider import-token cursor
pbcopy < /dev/null
```

Major stores the token at `<majorHome>/credentials/claude-code` or
`<majorHome>/credentials/cursor` (mode 0600, directory 0700) and re-probes.
It injects the token only into that provider's host processes, as
`CLAUDE_CODE_OAUTH_TOKEN` or `CURSOR_API_KEY`. Any copy of these names in
Major's own environment is still stripped. The audit log records the name
only, and Major scrubs the exact value from worker output. Major refuses a
token file that is a symlink, owned by another user or readable by group or
other.

Notes:

- The Claude probe confirms that the token is present, not that it is valid.
  The first worker run validates it. The Cursor probe validates the key.
- The token is in the provider process's environment, so every command that
  worker runs inherits it. The output scrub matches the exact value only; it
  cannot stop a worker that encodes or writes the token elsewhere. Treat a
  provider worker as able to use the token, as it can with an interactive
  login.
- To revoke, delete the file and revoke the token at the provider.
- Antigravity has a different cause. `agy` has no `auth status` command; the
  probe now runs `agy models`, which sends no prompt. Inside Major's Seatbelt
  profile `agy` cannot start, because it must bind a `127.0.0.1` listener and
  write logs under `~/.gemini/antigravity-cli`. The probe reports this as
  `sandbox-blocked:`. The fix is a containment policy change, not a login.
