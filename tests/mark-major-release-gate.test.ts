import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/mark-major-release-gate.py');

function run(recordPath: string, reason: string): { status: number; stderr: string } {
  try {
    execFileSync('python3', [SCRIPT, recordPath, reason], { encoding: 'utf8' });
    return { status: 0, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? -1, stderr: e.stderr ?? '' };
  }
}

describe('mark-major-release-gate.py', () => {
  it('rewrites releaseGate in place, atomically, preserving every other field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'major-release-gate-'));
    const path = join(dir, 'installed-release.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: '0.5.2',
        sha: 'a'.repeat(40),
        branch: 'main',
        releaseDir: '/some/release/dir',
        installedAt: 't1',
        releaseGate: 'passed',
        runtimeImmutableSnapshot: true,
      }),
    );
    const result = run(path, 'failed-post-install-health-check');
    expect(result.status).toBe(0);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(record).toMatchObject({
      version: '0.5.2',
      sha: 'a'.repeat(40),
      branch: 'main',
      releaseDir: '/some/release/dir',
      installedAt: 't1',
      releaseGate: 'failed-post-install-health-check',
      runtimeImmutableSnapshot: true,
    });
  });

  it('never leaves a .tmp file behind after a successful rewrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'major-release-gate-'));
    const path = join(dir, 'installed-release.json');
    writeFileSync(path, JSON.stringify({ sha: 'a'.repeat(40), releaseGate: 'passed' }));
    run(path, 'failed-content-manifest');
    expect(() => readFileSync(`${path}.tmp`)).toThrow();
  });

  it('refuses cleanly when the record file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'major-release-gate-'));
    const result = run(join(dir, 'does-not-exist.json'), 'failed-content-manifest');
    expect(result.status).not.toBe(0);
  });
});
