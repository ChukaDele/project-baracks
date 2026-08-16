import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * scripts/rollback-major-runtime.sh's activation path reuses
 * stage-major-user-state.py/activate-major-user-state.py, already covered by
 * validate-major-install-transaction.py's tests (including an actual SIGTERM
 * mid-activation). This file covers what's new here: identifying the prior
 * release from install-history.jsonl, and refusing rather than guessing when
 * that history is missing, empty, or the prior release fails verification.
 * Every case here is a refusal before any mutation, so a fixture $HOME is
 * enough — no real release needs to be built.
 */

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'rollback-major-runtime.sh');

function run(home: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function fixtureHome(): string {
  return mkdtempSync(join(tmpdir(), 'major-rollback-fixture-'));
}

describe('major rollback (refusal paths)', () => {
  it('refuses when no release has ever been installed', () => {
    const home = fixtureHome();
    const result = run(home);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no installed release found/);
  });

  it('refuses when there is no install history to identify a prior release from', () => {
    const home = fixtureHome();
    mkdirSync(join(home, '.major'), { recursive: true });
    writeFileSync(
      join(home, '.major', 'installed-release.json'),
      JSON.stringify({ sha: 'a'.repeat(40), version: '0.5.2' }),
    );
    const result = run(home);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no install history found/);
  });

  it('refuses when every history entry is the currently installed release', () => {
    const home = fixtureHome();
    mkdirSync(join(home, '.major'), { recursive: true });
    const sha = 'a'.repeat(40);
    writeFileSync(
      join(home, '.major', 'installed-release.json'),
      JSON.stringify({ sha, version: '0.5.2' }),
    );
    writeFileSync(
      join(home, '.major', 'install-history.jsonl'),
      `${JSON.stringify({ sha, version: '0.5.2', releaseDir: '/nonexistent', installedAt: 'now' })}\n`,
    );
    const result = run(home);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no prior release distinct from the current one/);
  });

  it('refuses to roll back to a prior release snapshot that is missing required files', () => {
    const home = fixtureHome();
    mkdirSync(join(home, '.major'), { recursive: true });
    const currentSha = 'a'.repeat(40);
    const priorSha = 'b'.repeat(40);
    const priorDir = join(home, '.major', 'releases', priorSha);
    mkdirSync(priorDir, { recursive: true }); // incomplete: no dist/entry.js, no runtime-manifest.json
    writeFileSync(
      join(home, '.major', 'installed-release.json'),
      JSON.stringify({ sha: currentSha, version: '0.5.2' }),
    );
    writeFileSync(
      join(home, '.major', 'install-history.jsonl'),
      [
        JSON.stringify({
          sha: priorSha,
          version: '0.5.1',
          releaseDir: priorDir,
          installedAt: 't1',
        }),
        JSON.stringify({
          sha: currentSha,
          version: '0.5.2',
          releaseDir: '/nonexistent',
          installedAt: 't2',
        }),
      ].join('\n') + '\n',
    );
    const result = run(home);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/prior release snapshot is incomplete/);
  });

  it('identifies the most recent DISTINCT prior release, not merely the previous line', () => {
    // History: install A, install B, install A again (e.g. a previous
    // rollback). Rolling back FROM A must find B — the most recent entry
    // whose sha differs from the current one — not the second-to-last line,
    // which would incorrectly resolve back to A itself.
    const home = fixtureHome();
    mkdirSync(join(home, '.major'), { recursive: true });
    const shaA = 'a'.repeat(40);
    const shaB = 'b'.repeat(40);
    writeFileSync(
      join(home, '.major', 'installed-release.json'),
      JSON.stringify({ sha: shaA, version: '0.5.1' }),
    );
    writeFileSync(
      join(home, '.major', 'install-history.jsonl'),
      [
        JSON.stringify({ sha: shaA, version: '0.5.1', releaseDir: '/rel-a', installedAt: 't1' }),
        JSON.stringify({ sha: shaB, version: '0.5.2', releaseDir: '/rel-b', installedAt: 't2' }),
        JSON.stringify({ sha: shaA, version: '0.5.1', releaseDir: '/rel-a', installedAt: 't3' }),
      ].join('\n') + '\n',
    );
    const result = run(home);
    // /rel-b does not exist, so this still refuses — but on the INCOMPLETE
    // check for rel-b specifically, proving B (not A) was selected.
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/-> b{40}/);
  });
});
