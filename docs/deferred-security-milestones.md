# Deferred security milestones

This build is a **disabled architectural foundation**: dry-run and inspection only.
Five capabilities are unavailable, each quarantined behind the hard-coded capability
gate (`src/security/capabilities.ts`) because independent review found its security
boundary bypassable at the claimed enforcement point. Each milestone below re-enables
exactly one capability. They are independently deliverable and independently
reviewable: none depends on another's implementation, and each has its own definition
of done. A capability is re-enabled only by the code change its milestone delivers,
together with a fresh independent security review of that boundary. No configuration
can do it.

## M1 — Trusted OS-isolated execution

Re-enables: `live-agent-execution` (`ExecutionGateway.execute`, `executeStreaming`,
provider `execute`) **and** executable probing.

Executable availability is represented as UNVERIFIED while the gate remains closed.
Executing a binary to verify its identity, version or auth state, even for discovery,
is part of this milestone and must use the same trusted, isolated boundary.

Definition of done:

- Content identity is validated at the actual spawn boundary. Every spawn re-verifies
  the trusted installation's content hash with no metadata-based fast path.
- Execution is gated on proven OS-level filesystem and network isolation. The
  mechanism must be applied to the spawned descendant tree, not inferred from a
  doctor report or configuration claim.
- Any executable probing that runs a binary is restored only through this boundary.
- The gateway's fail-closed documentation matches its behaviour exactly.
- Adversarial tests cover preserved-metadata replacement, sandbox-absent platforms,
  and allowed-root escape by a spawned descendant.
- Independent review confirms the boundary before the gate entry is removed.

## M2 — Authoritative provider and billing control

Re-enables: `paid-provider-execution`.

Definition of done:

- Every run uses an authoritative persisted billing observation.
- Paid approvals are purpose-scoped and expire.
- SQLite consumes each approval exactly once and atomically, including direct writes.
- Service and direct-SQL tests cover forged, mis-scoped, expired and reused approval.
- Independent review confirms the boundary before the gate entry is removed.

## M3 — Immutable database completion proof

Re-enables: `automated-task-completion`.

Definition of done:

- Completion criteria become durable and non-weakenable when execution starts.
- SQLite proves the full task-specific evidence set for every completed transition.
- Service and direct-SQL tests cover criteria weakening and concurrent completion.
- Independent review confirms the boundary before the gate entry is removed.

## M4 — Complete worker fencing

Re-enables: `worker-owned-downstream-mutations`.

Definition of done:

- Every worker mutation and downstream write requires the current unexpired fence.
- SQLite enforces fencing for every mutation surface, including direct writes.
- The single-host clock assumption is enforced or distributed timing is authoritative.
- Tests cover expired, superseded and cross-task tokens on every write surface.
- Independent review confirms the boundary before the gate entry is removed.

## M5 — Crash-safe external roadmap application

Re-enables: `external-roadmap-application`.

Definition of done:

- Reconciliation compares and swaps the exact attempt token it observed.
- Cross-host serialization is proven or the single-host assumption is enforced.
- The live adapter passes crash-window, replay and duplicate-apply contract tests.
- Tests cover delayed reconcilers and crashes on both sides of the external write.
- Independent review confirms the boundary before the gate entry is removed.
