import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLimaExecutionConfig } from '../src/execution/lima-config.js';

describe('Lima execution configuration', () => {
  it('loads only the reviewed backend fields and defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-lima-config-'));
    const path = join(root, 'execution.json');
    writeFileSync(path, JSON.stringify({ backend: 'lima' }));
    expect(loadLimaExecutionConfig(path)).toEqual({
      backend: 'lima',
      instance: 'major-worker',
      limactlPath: '/opt/homebrew/bin/limactl',
      isolationScope: 'shared-workshop',
      guestRunRoot: '/var/lib/major/runs',
    });
  });

  it.each([
    { backend: 'host' },
    { backend: 'lima', instance: '../other' },
    { backend: 'lima', guestRunRoot: 'relative' },
    { backend: 'lima', extra: true },
  ])('rejects unreviewed configuration %#', (value) => {
    const root = mkdtempSync(join(tmpdir(), 'major-lima-config-'));
    const path = join(root, 'execution.json');
    writeFileSync(path, JSON.stringify(value));
    expect(() => loadLimaExecutionConfig(path)).toThrow();
  });
});
