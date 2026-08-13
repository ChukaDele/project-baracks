import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAdoptionRecord } from '../src/reuse/adoption.js';
import { runReuseCli } from '../src/reuse/cli.js';

const COMPLETE = `# Adoption record: queue

## Problem
Need durable retries.
## Existing options considered
| Layer | Option | Evidence |
| --- | --- | --- |
| Current repository | Task claims | Existing recovery tests |
| Major skills/templates | research-before-build | Current skill registry |
| Current dependencies | SQLite | package version |
| Official platform | Node test runner | Official documentation |
| Maintained upstream | Workflow | GitHub commit review |
| Available tool/service | Hosted queue | Pricing page review |
## Chosen option
Keep repository claims.
## Why
They already satisfy the required restart behavior.
## What we reuse
Task claims and leases.
## What we tailor
One release report.
## What we will not build
A second workflow engine.
## License and version
Project-owned code at the current SHA.
## Exit strategy
Remove the report without migrating task state.
## Evidence
Claim and recovery tests at the current commit SHA.
`;

const REQUIRED_HEADINGS = [
  'Problem',
  'Existing options considered',
  'Chosen option',
  'Why',
  'What we reuse',
  'What we tailor',
  'What we will not build',
  'License and version',
  'Exit strategy',
  'Evidence',
];

describe('reuse adoption records', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('accepts a complete decision record', () => {
    expect(checkAdoptionRecord(COMPLETE)).toEqual({
      valid: true,
      missingSections: [],
      emptySections: [],
      missingSearchLayers: [],
      evidenceInsufficient: false,
      customBuildGapMissing: false,
    });
  });

  it('rejects research theatre and custom build without an unmet requirement', () => {
    const shallow = REQUIRED_HEADINGS.map((heading) => `## ${heading}\nx`).join('\n');
    const shallowResult = checkAdoptionRecord(shallow);
    expect(shallowResult.valid).toBe(false);
    expect(shallowResult.missingSearchLayers).toHaveLength(6);
    expect(shallowResult.evidenceInsufficient).toBe(true);

    const placeholderRows = COMPLETE.replace(
      '| Current repository | Task claims | Existing recovery tests |',
      '| Current repository | n/a | n/a |',
    );
    expect(checkAdoptionRecord(placeholderRows).missingSearchLayers).toContain(
      'Current repository',
    );

    const custom = COMPLETE.replace('Keep repository claims.', 'Build a bespoke queue ourselves.');
    expect(checkAdoptionRecord(custom).customBuildGapMissing).toBe(true);
    expect(
      checkAdoptionRecord(
        custom.replace(
          'They already satisfy the required restart behavior.',
          'Unmet requirement: no option provides the required offline recovery boundary.',
        ),
      ).valid,
    ).toBe(true);
  });

  it('rejects missing and placeholder decisions', () => {
    const result = checkAdoptionRecord(
      COMPLETE.replace('## Why\nThey already satisfy the required restart behavior.\n', '').replace(
        'Task claims and leases.',
        '[Maintained component.]',
      ),
    );
    expect(result.valid).toBe(false);
    expect(result.missingSections).toContain('Why');
    expect(result.emptySections).toContain('What we reuse');
  });

  it('reports a valid record through the CLI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'major-adoption-'));
    roots.push(root);
    const record = join(root, 'adoption.md');
    writeFileSync(record, COMPLETE);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runReuseCli(['not-reuse'])).resolves.toBe(false);
    await expect(runReuseCli(['reuse', 'check'])).rejects.toThrow(/usage/);
    await expect(runReuseCli(['reuse', 'check', record])).resolves.toBe(true);
    expect(log).toHaveBeenCalledWith(`valid adoption record: ${record}`);
  });
});
