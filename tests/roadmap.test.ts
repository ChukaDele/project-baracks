import { describe, expect, it } from 'vitest';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import type { RoadmapRow, UpdateProposal } from '../src/roadmap/types.js';

function rows(): RoadmapRow[] {
  return [
    {
      stableId: 'RM-1',
      values: { Title: 'Auth', Status: 'In Progress', Progress: '40%' },
      formulas: { Progress: '=COUNTIF(...)' },
    },
    { stableId: 'RM-2', values: { Title: 'Billing', Status: 'Todo' } },
  ];
}

function proposal(overrides: Partial<UpdateProposal> = {}): UpdateProposal {
  return {
    idempotencyKey: 'upd-1',
    changes: [{ stableId: 'RM-1', columns: { Status: 'Done' } }],
    rationale: 'all subtasks verified',
    evidenceRefs: ['evid_1'],
    ...overrides,
  };
}

describe('roadmap dry-run', () => {
  it('produces a diff without mutating the sheet', async () => {
    const adapter = new MockSheetsAdapter(rows());
    const result = await adapter.dryRun(proposal());
    expect(result.ok).toBe(true);
    expect(result.diff).toEqual([
      { stableId: 'RM-1', column: 'Status', from: 'In Progress', to: 'Done', isFormulaCell: false },
    ]);
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('In Progress');
  });
});

describe('evidence gating', () => {
  it('refuses to mark Done without evidence', async () => {
    const adapter = new MockSheetsAdapter(rows());
    const result = await adapter.apply(proposal({ evidenceRefs: [] }));
    expect(result.status).toBe('rejected');
    expect(result.violations.join()).toMatch(/without evidence/);
  });

  it('requires a rationale', async () => {
    const adapter = new MockSheetsAdapter(rows());
    const result = await adapter.dryRun(proposal({ rationale: '  ' }));
    expect(result.ok).toBe(false);
    expect(result.violations.join()).toMatch(/rationale/);
  });
});

describe('formula preservation', () => {
  it('refuses to overwrite formula-backed cells', async () => {
    const adapter = new MockSheetsAdapter(rows());
    const result = await adapter.apply(
      proposal({ changes: [{ stableId: 'RM-1', columns: { Progress: '50%' } }] }),
    );
    expect(result.status).toBe('rejected');
    expect(result.violations.join()).toMatch(/formula/);
  });
});

describe('atomicity and idempotency', () => {
  it('applies related updates atomically — one bad row rejects all', async () => {
    const adapter = new MockSheetsAdapter(rows());
    const result = await adapter.apply(
      proposal({
        changes: [
          { stableId: 'RM-2', columns: { Status: 'In Progress' } },
          { stableId: 'RM-404', columns: { Status: 'Done' } },
        ],
      }),
    );
    expect(result.status).toBe('rejected');
    expect((await adapter.readRow('RM-2'))?.values.Status).toBe('Todo');
  });

  it('applies a proposal exactly once per idempotency key', async () => {
    const adapter = new MockSheetsAdapter(rows());
    expect((await adapter.apply(proposal())).status).toBe('applied');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Done');
    expect((await adapter.apply(proposal())).status).toBe('already_applied');
  });
});
