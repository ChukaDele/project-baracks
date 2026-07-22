/**
 * Roadmap source contract (Google Sheets is the first implementation; the
 * mock implements the same contract). Writes are always proposal-based:
 * dry-run first, atomic, idempotent, and evidence-backed.
 */

export interface RoadmapRow {
  /** Stable row ID — the roadmap key, independent of row position. */
  stableId: string;
  values: Record<string, string>;
  /** Cells backed by formulas (column -> formula source). Never overwritten. */
  formulas?: Record<string, string>;
}

export interface RowChange {
  stableId: string;
  /** Column -> new value. */
  columns: Record<string, string>;
}

export interface UpdateProposal {
  /** Client-generated key; applying the same key twice is a no-op. */
  idempotencyKey: string;
  /** All changes apply atomically or not at all. */
  changes: RowChange[];
  rationale: string;
  /** Evidence record IDs/refs backing the update. */
  evidenceRefs: string[];
}

export interface DiffEntry {
  stableId: string;
  column: string;
  from: string | undefined;
  to: string;
  isFormulaCell: boolean;
}

export interface DryRunResult {
  ok: boolean;
  diff: DiffEntry[];
  violations: string[];
}

export interface ApplyResult {
  status: 'applied' | 'already_applied' | 'rejected';
  violations: string[];
}

export interface ApplyOptions {
  /**
   * The diff produced by the prior dry run. When present, apply re-checks
   * that every affected cell still holds the `from` value observed then —
   * changed source state rejects the write.
   */
  expectedDiff?: DiffEntry[];
}

export interface RoadmapAdapter {
  readRow(stableId: string): Promise<RoadmapRow | undefined>;
  readAll(): Promise<RoadmapRow[]>;
  /** Opaque revision of the source; changes whenever the source changes. */
  revision(): Promise<string>;
  /** Compute the diff and violations without writing anything. */
  dryRun(proposal: UpdateProposal): Promise<DryRunResult>;
  /** Atomic, idempotent write. Must refuse when dryRun reports violations. */
  apply(proposal: UpdateProposal, options?: ApplyOptions): Promise<ApplyResult>;
  /**
   * Read-only reconciliation query: has this idempotency key already been
   * applied to the source? Crash recovery consults this BEFORE any
   * revision-based invalidation, so an update that reached the source but
   * crashed before internal bookkeeping is reconciled, never misclassified
   * as superseded.
   */
  wasApplied(idempotencyKey: string): Promise<boolean>;
}
