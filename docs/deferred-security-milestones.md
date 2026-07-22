# Deferred security milestones

This build is a **disabled architectural foundation**: dry-run and inspection only.
Five capabilities are unavailable, each quarantined behind the hard-coded capability
gate (`src/security/capabilities.ts`) because independent review found its security
boundary bypassable at the claimed enforcement point. Each milestone below re-enables
exactly one capability. They are independently deliverable and independently
reviewable: none depends on another's implementation, and each has its own definition
of done. A capability is re-enabled only by the code change its milestone delivers —
removing its entry from the gate — together with a fresh independent security review
of that boundary; no configuration can do it.

## M1 — Trusted OS-isolated execution

Re-enables: `live-agent-execution` (`ExecutionGateway.execute`, `executeStreaming`,
provider `execute`) **and** executable probing.

In this disabled foundation, discovery is resolution-only and PROCESS-FREE: the
gateway exposes only `resolveExecutable` (a PATH lookup for reporting) and NO
process-creating path — the former `--version` / `which` / `execFileSync` probe was
removed because it could run an environment/PATH-selected binary outside any isolation.
Executable availability is therefore represented as UNVERIFIED. Executing a binary to
verify its identity, version or auth state — even for discovery — is part of THIS
milestone and must be restored only behind the same trusted, isolated boundary.

Known gaps: executable identity verification skips content hashing when file metadata
appears unchanged (preserved-metadata mutation gap); execution is gated on
process-group containment without OS filesystem/network isolation; a resolvable binary
cannot yet be verified because no isolated execution path exists.

Definition of done:

- Content identity is validated at the actual spawn boundary: every spawn re-verifies
  the trusted installation's content hash, with no metadata-based fast path that can
  accept a mutated binary.
- Execution is gated on proven OS-level filesystem (and network, where required)
  isolation — an enforced sandbox mechanism, not process-group containment alone and
  not a doctor report or configuration claim.
- Any executable probing that runs a binary (version/auth discovery) is reintroduced
  only through this trusted, isolated boundary — never as a supposedly read-only path
  that spawns an environment/PATH-selected executable.
- The gateway's fail-closed documentation matches its behaviour exactly.
- Adversarial tests cover binary replacement with preserved metadata, sandbox-absent
  platforms, and escape of the allowed roots by a spawned descendant.
- Independent review confirms the boundary before the gate entry is removed.

## M2 — Authoritative provider and billing control

Re-enables: `paid-provider-execution` (paid routes in `route`, paid billing modes in
`createRun`).

Known gaps: run creation accepted an unobserved model with a caller-supplied
non-unknown billing mode; paid approvals were not purpose-scoped; one-use enforcement
depended on the service helper rather than the durable boundary.

Definition of done:

- A run cannot be created for any model without an authoritative persisted billing
  observation; caller-supplied billing is never accepted for an unobserved model, at
  the service layer and at the SQLite boundary.
- Paid approvals are purpose-scoped (task, project, provider/model, purpose) and
  expire; a missing or partial scope authorises nothing.
- An approval is consumed exactly once, atomically, at the durable (SQLite) boundary,
  including for direct inserts — not only via the service helper.
- Adversarial tests cover forged/mis-scoped/expired/reused approvals through both the
  service and direct SQL.
- Independent review confirms the boundary before the gate entry is removed.

## M3 — Immutable database completion proof

Re-enables: `automated-task-completion` (the `-> completed` transition).

Known gap: completion criteria are mutable — a direct update can weaken them before,
or during, the completion transition.

Definition of done:

- A task's completion criteria are durable and non-weakenable once the task enters
  execution: the SQLite boundary refuses any write that weakens recorded criteria,
  and the completion transition proves against the recorded criteria as of
  dispatch, not a mutable current value.
- The full proof set (qualifying verification runs, resolved blocking findings,
  verified evidence relationships, task-specific criteria) is enforced at the SQLite
  boundary for every path that can set `completed`.
- Adversarial tests cover criteria weakening before and concurrent with the
  transition, via the service and via direct SQL.
- Independent review confirms the boundary before the gate entry is removed.

## M4 — Complete worker fencing

Re-enables: `worker-owned-downstream-mutations` (claim acquisition and exercise,
fence-carrying transitions, claim-bound run creation).

Known gaps: evidence insertion had no run/claim linkage and was unfenced;
worker-driven task transitions could omit the optional fence; review and
roadmap-proposal writes were not comprehensively fenced.

Definition of done:

- Every worker-owned mutation and downstream write — task transitions, run status,
  run events, usage, verification runs, evidence, review findings, roadmap
  proposals — requires the current unexpired fencing token; no worker path accepts
  an omitted fence.
- Fencing is enforced at the SQLite boundary for every such write, not only in
  service helpers.
- The single-host/single-database clock assumption is retained and documented, or
  authoritative distributed lease timing is introduced.
- Adversarial tests cover expired, superseded and cross-task tokens on every write
  surface, including direct SQL.
- Independent review confirms the boundary before the gate entry is removed.

## M5 — Crash-safe external roadmap application

Re-enables: `external-roadmap-application` (`applyRoadmapUpdate`,
`reconcileRoadmapApplies`, and a live Sheets adapter).

Known gap: reconciliation does not compare-and-swap against the exact attempt token
it inspected, so a delayed reconciler can displace a newer in-flight attempt;
adapter idempotency limits duplicate external effects but does not repair the
ownership race.

Definition of done:

- Reconciliation compares-and-swaps using the exact attempt token it observed;
  a delayed reconciler can never displace a newer in-flight attempt.
- Cross-host serialization is proven through a strongly idempotent adapter plus
  distributed coordination, or the single-host assumption is enforced and
  documented.
- The live adapter passes the same contract test suite as the mock, including
  crash-window, duplicate-apply and reconciliation scenarios.
- Adversarial tests cover delayed reconcilers racing live attempts, crashes on both
  sides of the external write, and idempotency-key replay.
- Independent review confirms the boundary before the gate entry is removed.
