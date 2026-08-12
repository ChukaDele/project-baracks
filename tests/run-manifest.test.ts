import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  manifestPath,
  pendingRunManifests,
  readRunManifest,
  writeRunManifest,
  type LimaRunManifest,
} from '../src/execution/run-manifest.js';

const runId = '11111111-1111-4111-8111-111111111111';

function fixture(root: string): LimaRunManifest {
  return {
    runId,
    provider: 'codex',
    projectHash: 'a'.repeat(64),
    guestRun: `/var/lib/major/runs/codex/${runId}`,
    state: 'running',
    cleanup: 'pending',
    startedAt: '2026-08-12T12:00:00.000Z',
  };
}

describe('Lima run manifests', () => {
  it('writes an atomic, permission-limited manifest and finds pending cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-manifest-'));
    mkdirSync(join(root, 'runs', runId), { recursive: true, mode: 0o700 });
    writeRunManifest(root, fixture(root));
    expect(readRunManifest(manifestPath(root, runId))).toEqual(fixture(root));
    expect(pendingRunManifests(root)).toEqual([fixture(root)]);
    expect(readFileSync(manifestPath(root, runId), 'utf8')).not.toContain('/Users/');
  });

  it('rejects a guest path that does not match its provider and run identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-manifest-'));
    mkdirSync(join(root, 'runs', runId), { recursive: true, mode: 0o700 });
    expect(() =>
      writeRunManifest(root, {
        ...fixture(root),
        guestRun: `/var/lib/major/runs/claude/${runId}`,
      }),
    ).toThrow(/does not match provider/);
  });

  it('does not treat completed manifests as stale work', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-manifest-'));
    mkdirSync(join(root, 'runs', runId), { recursive: true, mode: 0o700 });
    writeRunManifest(root, { ...fixture(root), state: 'terminal', cleanup: 'complete' });
    expect(pendingRunManifests(root)).toEqual([]);
  });

  it('fails closed when a run manifest is missing or malformed', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-manifest-'));
    mkdirSync(join(root, 'runs', runId), { recursive: true, mode: 0o700 });
    expect(() => pendingRunManifests(root)).toThrow();
    writeFileSync(manifestPath(root, runId), '{}\n');
    expect(() => pendingRunManifests(root)).toThrow();
  });
});
