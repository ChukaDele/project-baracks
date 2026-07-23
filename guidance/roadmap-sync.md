# Roadmap-synchronisation rules

The roadmap source (Google Sheets for Surface Talent) is the human-owned source of truth.
Major proposes; humans (or approved automation) dispose.

- Roadmap rows are addressed only by their **stable ID** column, never by row position.
- Every write is an `UpdateProposal`: idempotency key, atomic set of related changes,
  rationale, and evidence refs. Partial application is forbidden — one invalid change
  rejects the whole proposal.
- Every proposal is bound to its canonical payload hash; the idempotency key embeds the
  hash, so the same key can never carry different changes.
- Every proposal is dry-run first; the dry-run diff, timestamp and the source revision
  observed then are stored on the `roadmap_updates` record before any apply. Applying
  requires that exact prior dry run; changed source state (revision or cell values)
  invalidates the proposal instead of overwriting human edits.
- Applying the same idempotency key twice is a no-op (`already_applied`).
- Evidence backing a Done change must belong to tasks of that roadmap item — a
  non-empty evidence string is not sufficient.
- Roadmap permission grants no other authority: never merge, deploy, spend, or run
  destructive commands on the strength of being allowed to propose roadmap updates.
- Formula-backed cells are never overwritten.
- A row is never set to Done (or any equivalent value) without at least one evidence
  reference, and marking Done additionally requires an approved `roadmap_done`
  DecisionRequest.
- Tests and dry runs never perform live writes; the mock adapter
  (`src/roadmap/mock-sheets.ts`) implements the identical contract.
