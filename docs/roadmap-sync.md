# Roadmap synchronisation

Binding rules: `guidance/roadmap-sync.md`. Mechanics:

## Contract (`src/roadmap/types.ts`)

`RoadmapAdapter` exposes `readRow`/`readAll` (stable-ID addressed), `dryRun`, and
`apply`. Writes only travel as `UpdateProposal`s:

```ts
{
  idempotencyKey: 'task_x-completed-2026-07-22',
  changes: [{ stableId: 'RM-1', columns: { Status: 'Done', Notes: '…' } }],
  rationale: 'all subtasks verified and reviewed',
  evidenceRefs: ['evid_…'],
}
```

## Shared validation (`src/roadmap/validate.ts`)

`evaluateProposal` builds the cell-level diff and collects violations; both the mock and
the future live adapter call it, so the rules cannot drift between them:

- missing rows reject the whole proposal (atomicity);
- formula-backed cells are never overwritten;
- a status change to Done/Complete/Completed with zero evidence refs is refused;
- rationale and idempotency key are mandatory;
- when apply carries the prior dry run's diff, any cell whose current value differs
  from the `from` observed then rejects the proposal (`source changed since dry run`).

## Proposal integrity (`src/roadmap/proposal-service.ts`)

A persisted `roadmap_updates` row binds the proposal to:

- its **canonical payload hash** (`proposalPayloadHash`, sorted-key JSON over the
  change set) — the idempotency key embeds this hash, so the same key can never carry
  a different payload; the stored payload is immutable at the DB level (trigger);
- the **source revision** observed at dry-run time (`adapter.revision()`), recorded
  with the dry-run diff and timestamp. Apply requires that exact prior dry run. A
  changed source revision supersedes the proposal ONLY after idempotency
  reconciliation: `adapter.wasApplied(key)` is consulted first, so an update whose
  external write already landed (a prior attempt crashed before internal bookkeeping)
  is marked `applied`, never misclassified as `superseded`;
- **verified evidence relationships** for Done changes: every evidence id must exist
  and belong to a task of this roadmap item — a non-empty evidence string proves
  nothing;
- an approved **`roadmap_done` DecisionRequest**, verified against the database, for
  any Done change.

Roadmap permission grants nothing else: no merge, deploy, paid-usage or destructive
authority is ever inferred from the ability to propose roadmap updates.

## Apply protocol (DISABLED in this build)

External roadmap application is an unavailable capability: `applyRoadmapUpdate` and
`reconcileRoadmapApplies` refuse unconditionally before touching the adapter, so no
external roadmap write can occur through any code path. Proposals and their recorded
dry runs remain fully available (read-only against the source).

The retained protocol is milestone M5 groundwork — a claimed two-phase apply
(validate; CAS `proposed → applying` under a fresh `apply_attempt_id`; external
`adapter.apply`; CAS `applying → applied/rejected` under the same attempt id) with
idempotency-first reconciliation of stuck attempts. KNOWN M5 GAP: reconciliation does
not compare-and-swap against the exact attempt token it inspected, so a delayed
reconciler could displace a newer in-flight attempt. The protocol must not be treated
as crash-safe until M5 closes that gap and is independently reviewed.

## Mock vs. live

`MockSheetsAdapter` implements the full contract in memory (atomic apply, idempotency
keys, formula maps) and is what tests and dry runs use — tests never perform live writes.
No live Google Sheets adapter exists in this build; it arrives with milestone M5,
implementing the same interface using the Sheets batchUpdate API (atomic),
value+formula reads (`valueRenderOption: FORMULA`) for formula detection, and the
`roadmap_updates` table for idempotency and audit.
