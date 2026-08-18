import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resourceTestFiles } from '../vitest.resource-test-files.js';

describe('release test scheduling', () => {
  it('keeps ordinary tests parallel and serializes only shared host-resource tests', () => {
    const root = resolve(import.meta.dirname, '..');
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const parallelConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
    const resourceConfig = readFileSync(join(root, 'vitest.resource.config.ts'), 'utf8');

    expect(packageJson.scripts.test).toBe('pnpm test:parallel && pnpm test:resource');
    expect(packageJson.scripts['test:parallel']).toBe('vitest run');
    expect(packageJson.scripts['test:resource']).toBe(
      'vitest run --config vitest.resource.config.ts',
    );
    expect(parallelConfig).toContain('exclude: resourceTestFiles');
    expect(resourceConfig).toContain('include: resourceTestFiles');
    expect(resourceConfig).toContain('maxWorkers: 1');
    expect(resourceConfig).toContain('fileParallelism: false');
    expect(resourceTestFiles).toEqual([
      'tests/execution-containment.test.ts',
      'tests/lima-provisioner.test.ts',
      'tests/real-worker-containment.test.ts',
    ]);
  });
});
