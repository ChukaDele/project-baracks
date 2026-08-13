import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const manifest = resolve('scripts/major-runtime-manifest.mjs');

function run(mode: 'create' | 'verify', root: string) {
  return spawnSync(process.execPath, [manifest, mode, root], { encoding: 'utf8' });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('immutable runtime manifest', () => {
  it('binds file content, permissions and internal symlink targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-runtime-manifest-'));
    roots.push(root);
    mkdirSync(join(root, 'store'));
    writeFileSync(join(root, 'store', 'a.js'), 'a');
    writeFileSync(join(root, 'store', 'b.js'), 'b');
    symlinkSync('store/a.js', join(root, 'dependency'));
    expect(run('create', root).status).toBe(0);
    expect(run('verify', root).status).toBe(0);
    unlinkSync(join(root, 'dependency'));
    symlinkSync('store/b.js', join(root, 'dependency'));
    expect(run('verify', root).status).not.toBe(0);
  });

  it('rejects absolute and escaping runtime symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-runtime-escape-'));
    roots.push(root);
    symlinkSync('/tmp', join(root, 'absolute'));
    expect(run('create', root).status).not.toBe(0);
    unlinkSync(join(root, 'absolute'));
    symlinkSync('../outside', join(root, 'relative'));
    expect(run('create', root).status).not.toBe(0);
  });
});
