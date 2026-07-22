# Roadmap-synchronisation rules

The roadmap source (Google Sheets for Surface Talent) is the human-owned source of truth.
Major proposes; humans (or approved automation) dispose.

- Roadmap rows are addressed only by their **stable ID** column, never by row position.
- Every write is an `UpdateProposal`: idempotency key, atomic set of related changes,
  rationale, and evidence refs. Partial application is forbidden — one invalid change
  rejects the whole proposal.
- Every proposal is dry-run first; the dry-run diff is stored on the `roadmap_updates`
  record before any apply.
- Applying the same idempotency key twice is a no-op (`already_applied`).
- Formula-backed cells are never overwritten.
- A row is never set to Done (or any equivalent value) without at least one evidence
  reference, and marking Done additionally requires an approved `roadmap_done`
  DecisionRequest.
- Tests and dry runs never perform live writes; the mock adapter
  (`src/roadmap/mock-sheets.ts`) implements the identical contract.
