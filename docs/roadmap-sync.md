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
- rationale and idempotency key are mandatory.

## Mock vs. live

`MockSheetsAdapter` implements the full contract in memory (atomic apply, idempotency
keys, formula maps) and is what tests and dry runs use — tests never perform live writes.
The live Google Sheets adapter is a later track: it will implement the same interface
using the Sheets batchUpdate API (atomic), value+formula reads (`valueRenderOption:
FORMULA`) for formula detection, and the `roadmap_updates` table for idempotency and
audit (proposal → dry-run diff → applied/rejected).
