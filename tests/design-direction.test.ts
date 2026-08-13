import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDesignDirectionRecord,
  checkDesignDirectionRecordFile,
} from '../src/design/direction.js';

const APPROVED = `# Design direction decision
Status: approved
Selected direction: Progressive with conservative structure
Approval source: approved-hybrid
Approval evidence: Owner task message dated 2026-08-13
Conservative moodboard: direction-a/index.html
Progressive moodboard: direction-b/index.html
Exploratory moodboard: direction-c/index.html
Reference map: reference-map.md
Design contract: design-contract.md
`;

describe('design direction approval record', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('accepts a durable approved direction', () => {
    expect(checkDesignDirectionRecord(APPROVED)).toEqual({
      valid: true,
      missingFields: [],
      invalidFields: [],
      missingArtifacts: [],
      escapedArtifacts: [],
    });
  });

  it('binds the approval to existing in-project artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-design-project-'));
    roots.push(root);
    const research = join(root, 'design-research');
    for (const path of [
      'direction-a/index.html',
      'direction-b/index.html',
      'direction-c/index.html',
      'reference-map.md',
      'design-contract.md',
    ]) {
      const target = join(research, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, 'evidence');
    }
    const record = join(research, 'direction-decision.md');
    writeFileSync(record, APPROVED);
    expect(checkDesignDirectionRecordFile(record, root).valid).toBe(true);
    writeFileSync(record, APPROVED.replace('direction-c/index.html', 'missing.html'));
    expect(checkDesignDirectionRecordFile(record, root).missingArtifacts).toContain(
      'Exploratory moodboard',
    );
    const foreign = mkdtempSync(join(tmpdir(), 'major-design-foreign-'));
    roots.push(foreign);
    expect(() => checkDesignDirectionRecordFile(record, foreign)).toThrow(
      /inside the current project/,
    );
  });

  it('requires external references to be captured in a local manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-design-url-'));
    roots.push(root);
    const research = join(root, 'design-research');
    mkdirSync(research, { recursive: true });
    const record = join(research, 'direction-decision.md');
    writeFileSync(
      record,
      APPROVED.replace('direction-a/index.html', 'https://figma.com/file/example'),
    );
    expect(checkDesignDirectionRecordFile(record, root).missingArtifacts).toContain(
      'Conservative moodboard',
    );
  });

  it('rejects pending, missing and invented approval sources', () => {
    const pending = APPROVED.replace('Status: approved', 'Status: pending')
      .replace('Approval source: approved-hybrid', 'Approval source: agent-selected')
      .replace(/^Approval evidence:.*$/m, '');
    const result = checkDesignDirectionRecord(pending);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('Approval evidence');
    expect(result.invalidFields).toContain('Status');
    expect(result.invalidFields).toContain('Approval source');
  });
});
