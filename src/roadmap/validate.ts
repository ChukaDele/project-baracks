import type { DiffEntry, RoadmapRow, UpdateProposal } from './types.js';

export interface ProposalPolicy {
  /** Column holding the roadmap status. */
  statusColumn?: string;
  /** Values that mean "Done" and therefore require evidence. */
  doneValues?: readonly string[];
}

const DEFAULT_POLICY: Required<ProposalPolicy> = {
  statusColumn: 'Status',
  doneValues: ['Done', 'Complete', 'Completed'],
};

/**
 * Shared proposal validation used by every roadmap adapter (mock and live):
 * builds the diff and collects violations. Rules:
 *  - every referenced row must exist (atomicity: one miss rejects all);
 *  - formula cells are never overwritten;
 *  - a row cannot be marked Done without at least one evidence ref;
 *  - a rationale is required.
 */
export function evaluateProposal(
  proposal: UpdateProposal,
  rows: Map<string, RoadmapRow>,
  policy: ProposalPolicy = {},
  expectedDiff?: readonly DiffEntry[],
): { diff: DiffEntry[]; violations: string[] } {
  const { statusColumn, doneValues } = { ...DEFAULT_POLICY, ...policy };
  const diff: DiffEntry[] = [];
  const violations: string[] = [];

  if (!proposal.rationale.trim()) violations.push('rationale is required');
  if (!proposal.idempotencyKey.trim()) violations.push('idempotencyKey is required');

  for (const change of proposal.changes) {
    const row = rows.get(change.stableId);
    if (!row) {
      violations.push(`row not found: ${change.stableId}`);
      continue;
    }
    for (const [column, newValue] of Object.entries(change.columns)) {
      const isFormulaCell = Boolean(row.formulas && column in row.formulas);
      const expected = expectedDiff?.find(
        (e) => e.stableId === change.stableId && e.column === column,
      );
      if (expected && expected.from !== row.values[column]) {
        violations.push(
          `source changed since dry run: ${change.stableId}.${column} was ` +
            `${JSON.stringify(expected.from)}, now ${JSON.stringify(row.values[column])}`,
        );
      }
      diff.push({
        stableId: change.stableId,
        column,
        from: row.values[column],
        to: newValue,
        isFormulaCell,
      });
      if (isFormulaCell) {
        violations.push(`refusing to overwrite formula cell ${change.stableId}.${column}`);
      }
      if (
        column === statusColumn &&
        doneValues.some((v) => v.toLowerCase() === newValue.toLowerCase()) &&
        proposal.evidenceRefs.length === 0
      ) {
        violations.push(`refusing to mark ${change.stableId} as "${newValue}" without evidence`);
      }
    }
  }
  return { diff, violations };
}
