# Toolsmith and validation

Toolsmith is Major's small, project-scoped capability acquisition boundary. It
does not install packages, call a marketplace, or grant runtime authority by
itself.

## Capability lifecycle

1. Resolve a matching `preferred` or `validated` project capability first.
2. If none exists, the supervisor invokes bounded discovery in the same goal
   cycle. The current local catalog can discover only Major's existing,
   read-only path canonicalization adapter. The discovery interface supports internal
   adapters, installed integrations, local CLIs, dependencies, approved
   providers, catalog entries, and thin adapters without implementing package
   search or installation.
3. Rank acceptable candidates in that order. Reject high-risk, paid,
   authority-expanding, license-missing, or failed-preflight candidates.
4. Provision an accepted candidate as `provisional`, then run its
   capability-specific verifier. A failing candidate stays blocked. Toolsmith
   considers the next bounded safe candidate, then blocks the original goal
   once if none validates. It does not schedule an acquisition retry loop.
5. `provisionCapability()` stores only a preflight-passing candidate as
   `provisional`. It is not eligible for ordinary reuse.
6. Manual validation requires a passed, persisted verification run from the
   named reviewer, plus reviewer evidence and a capability-specific artifact.
   The reviewer cannot be the candidate discoverer. A local catalog verifier
   may validate only Major's one existing, low-risk adapter. Its verifier is a
   separate deterministic module. The adapter reference and its runtime
   source revision must match exactly. Both routes bind the artifact to a
   SHA-256 fingerprint of the exact source descriptor.
   The record distinguishes this deterministic `capability_verified` result
   from a normal `independently_validated` provider run.
   A manual verification run must also record Major's immutable validation
   subject for that capability version and operation, and its task must belong
   to the capability project. An unrelated passed run cannot be replayed.
7. Real use outcomes update the record. Two failures degrade it. Two successful
   validated uses with no failures can make it `preferred`. Deprecation removes
   it from future routing while retaining append-only evidence.

Records live in Major's existing control-plane database. They are not a second
skill registry or a replacement for GBrain. The immutable build gates in
`src/security/capabilities.ts` remain separate: a Toolsmith record never opens
live execution, spending, completion, mutation, or roadmap authority.

## Verification artifact

Each validation stores one compact `capability_verification_artifacts` row.
It records the capability, source fingerprint, operation, fixture, expected and
actual result, validator, environment, security result, timestamp, pass/fail,
and optional independent verification run. It stores summaries and structured
facts only, not large logs. A changed source fingerprint makes the old artifact
ineligible for reuse.

## Return to the original goal

Capability resolution happens before `runWorker()` in `runGoalCycle()`. A
reused or newly validated capability is included in the same worker prompt, so
the original goal continues in that cycle. A worker can report bounded
capability-use evidence. Major stores this as append-only provenance only. It
does not increase success counts or promote a capability.

## Tool and skill boundary

- A capability answers: "What can this project safely use?"
- A skill answers: "How should Major perform this recurring job?"
- GBrain's existing lifecycle observes successful task workflows, requires
  recurrence plus independent validation, and then promotes a project-local
  skill. Registering or validating one capability never creates a skill.

After a successful task, the normal worker-report path should send its bounded
workflow observation to the existing skill lifecycle. That lifecycle already
holds one-offs as candidates, prevents duplicate skills, records outcomes, and
deprecates poor performers.

## Artifact-aware validation

`src/validation/artifacts.ts` runs deterministic checks before a required
independent/model review. It uses different evidence contracts for writing,
code, analysis, presentations, and web artifacts. It does not use a universal
judge prompt.

An artifact reports deterministic success only. It never claims independent
or production validation from caller-supplied evidence. The existing Major
independent-grade and runtime-evidence paths must make those stronger claims.

For web artifacts, `src/validation/ship-gate.ts` requires evidence for the
critical journey, error states, data source and states, desktop/mobile visual
QA, build/console/network health, performance, secret/auth boundaries, and
deployment health. Public sites also require SEO evidence. Missing evidence is
a blocker, not a pass inferred from a build.

The gate consumes runtime evidence supplied by the relevant browser, deploy,
security, or test adapter. It does not claim that a local report proves a
remote browser or production deployment.
