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

## Crash-consistent apply protocol

The external write and the internal `applied` record cannot be one atomic operation,
so apply runs a claimed two-phase protocol (`applyRoadmapUpdate`):

1. validations (payload binding, dry run, evidence, decision);
2. compare-and-swap `proposed → applying` under a fresh `apply_attempt_id` — exactly
   one worker can win this claim; a second concurrent apply is refused
   (`apply in progress`), and the DB refuses `applying` rows without an attempt id;
3. `adapter.apply(...)` — a crash here leaves durable `applying` state;
4. compare-and-swap `applying → applied/rejected` under the SAME attempt id.

`reconcileRoadmapApplies` resolves any update stuck in `applying`: if
`adapter.wasApplied(idempotencyKey)` the external write happened and the update is
marked `applied`; otherwise it returns to `proposed` for a fresh, fully re-validated
attempt. Repeated recovery is a no-op.

## Mock vs. live

`MockSheetsAdapter` implements the full contract in memory (atomic apply, idempotency
keys, formula maps) and is what tests and dry runs use — tests never perform live writes.
The live Google Sheets adapter is a later track: it will implement the same interface
using the Sheets batchUpdate API (atomic), value+formula reads (`valueRenderOption:
FORMULA`) for formula detection, and the `roadmap_updates` table for idempotency and
audit (proposal → dry-run diff → applied/rejected).
