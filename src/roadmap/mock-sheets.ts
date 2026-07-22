import { evaluateProposal, type ProposalPolicy } from './validate.js';
import type {
  ApplyResult,
  DryRunResult,
  RoadmapAdapter,
  RoadmapRow,
  UpdateProposal,
} from './types.js';

/**
 * In-memory stand-in for the Google Sheets adapter. Implements the full
 * contract — atomic apply, idempotency, formula preservation, evidence
 * gating — without touching any live spreadsheet. Used by tests and dry runs.
 */
export class MockSheetsAdapter implements RoadmapAdapter {
  private readonly rows: Map<string, RoadmapRow>;
  private readonly appliedKeys = new Set<string>();
  private readonly policy: ProposalPolicy;

  constructor(rows: RoadmapRow[] = [], policy: ProposalPolicy = {}) {
    this.rows = new Map(rows.map((r) => [r.stableId, structuredClone(r)]));
    this.policy = policy;
  }

  async readRow(stableId: string): Promise<RoadmapRow | undefined> {
    const row = this.rows.get(stableId);
    return row ? structuredClone(row) : undefined;
  }

  async readAll(): Promise<RoadmapRow[]> {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }

  async dryRun(proposal: UpdateProposal): Promise<DryRunResult> {
    const { diff, violations } = evaluateProposal(proposal, this.rows, this.policy);
    return { ok: violations.length === 0, diff, violations };
  }

  async apply(proposal: UpdateProposal): Promise<ApplyResult> {
    if (this.appliedKeys.has(proposal.idempotencyKey)) {
      return { status: 'already_applied', violations: [] };
    }
    const { violations } = evaluateProposal(proposal, this.rows, this.policy);
    if (violations.length > 0) return { status: 'rejected', violations };

    // Atomic: validation passed for every change, so write them all.
    for (const change of proposal.changes) {
      const row = this.rows.get(change.stableId);
      if (!row) return { status: 'rejected', violations: [`row vanished: ${change.stableId}`] };
      Object.assign(row.values, change.columns);
    }
    this.appliedKeys.add(proposal.idempotencyKey);
    return { status: 'applied', violations: [] };
  }
}
