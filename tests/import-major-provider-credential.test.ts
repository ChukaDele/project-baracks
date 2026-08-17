import { linkSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * scripts/import-major-provider-credential.py only runs for real as root
 * inside the Lima guest (main() refuses immediately otherwise), so its
 * root/chown-dependent happy path can't be exercised on a dev Mac. What CAN
 * be tested here, without root, is exactly the fix for the adversarial
 * review's TOCTOU finding: open_verified_source() and write_verified_staging()
 * never re-touch the staged PATH after the initial verified open — they
 * operate only on the already-open file descriptor. The decisive test below
 * proves this directly: open a real file, then swap the path out from under
 * it for a symlink to different content (the exact race the broker used to
 * be vulnerable to), and confirm the copied bytes are still the ORIGINAL
 * content, not the swapped-in target's.
 */

const SCRIPT = resolve('scripts/import-major-provider-credential.py');

function pythonDriver(
  code: string,
  stagedPath: string,
): { status: number; stdout: string; stderr: string } {
  const full = `
import importlib.util
spec = importlib.util.spec_from_file_location("broker", ${JSON.stringify(SCRIPT)})
broker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broker)
${code}
`;
  try {
    const stdout = execFileSync('python3', ['-c', full], {
      encoding: 'utf8',
      env: { ...process.env, MAJOR_CREDENTIAL_IMPORT_STAGED_PATH: stagedPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'major-credential-broker-'));
}

describe('import-major-provider-credential.py: open_verified_source (TOCTOU fix)', () => {
  it('opens a plain regular staged file and returns its real content via the fd', () => {
    const dir = fixtureDir();
    const staged = join(dir, 'staged');
    writeFileSync(staged, 'real-credential-bytes');
    const result = pythonDriver(
      `
import os
fd = broker.open_verified_source()
print(os.read(fd, 4096).decode())
os.close(fd)
`,
      staged,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('real-credential-bytes');
  });

  it('refuses a symlinked staged path', () => {
    const dir = fixtureDir();
    const real = join(dir, 'real.json');
    writeFileSync(real, 'x');
    const staged = join(dir, 'staged');
    symlinkSync(real, staged);
    const result = pythonDriver('broker.open_verified_source()', staged);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe or missing staged credential copy/);
  });

  it('refuses a hardlinked staged path', () => {
    const dir = fixtureDir();
    const original = join(dir, 'other.json');
    writeFileSync(original, 'x');
    const staged = join(dir, 'staged');
    linkSync(original, staged);
    const result = pythonDriver('broker.open_verified_source()', staged);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe or missing staged credential copy/);
  });

  it('refuses a missing staged path', () => {
    const dir = fixtureDir();
    const result = pythonDriver('broker.open_verified_source()', join(dir, 'does-not-exist'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unsafe or missing staged credential copy/);
  });

  it('the fix: copies the ORIGINAL file content even when the path is swapped for a symlink to different content immediately after the verified open', () => {
    // This is the exact race from the adversarial review's HIGH finding:
    // check the path, then (in the gap before use) swap it for a symlink to
    // an arbitrary target. The old code re-opened/copied BY PATH after the
    // check and would have followed the swapped-in symlink. The fix opens
    // once and operates only on that file descriptor from then on.
    const dir = fixtureDir();
    const staged = join(dir, 'staged');
    writeFileSync(staged, 'ORIGINAL-SECRET-CONTENT');
    const attackerTarget = join(dir, 'attacker-target');
    writeFileSync(attackerTarget, 'ATTACKER-CONTROLLED-CONTENT');
    const stagingOut = join(dir, 'staging.next');

    const result = pythonDriver(
      `
import os
fd = broker.open_verified_source()
# Simulate the race: swap the path for a symlink to a different file AFTER
# the verified open but BEFORE the fd's content is used.
os.unlink(${JSON.stringify(staged)})
os.symlink(${JSON.stringify(attackerTarget)}, ${JSON.stringify(staged)})
import pathlib
broker.write_verified_staging(fd, pathlib.Path(${JSON.stringify(stagingOut)}))
os.close(fd)
`,
      staged,
    );
    expect(result.status).toBe(0);
    const written = execFileSync('cat', [stagingOut], { encoding: 'utf8' });
    expect(written).toBe('ORIGINAL-SECRET-CONTENT');
    expect(written).not.toContain('ATTACKER-CONTROLLED-CONTENT');
  });

  it('write_verified_staging refuses to reuse a pre-existing symlink at the staging destination', () => {
    const dir = fixtureDir();
    const staged = join(dir, 'staged');
    writeFileSync(staged, 'real-bytes');
    const attackerTarget = join(dir, 'attacker-target');
    writeFileSync(attackerTarget, 'should-not-be-touched');
    const stagingOut = join(dir, 'staging.next');
    symlinkSync(attackerTarget, stagingOut);

    const result = pythonDriver(
      `
import os, pathlib
fd = broker.open_verified_source()
broker.write_verified_staging(fd, pathlib.Path(${JSON.stringify(stagingOut)}))
os.close(fd)
`,
      staged,
    );
    expect(result.status).toBe(0);
    const written = execFileSync('cat', [stagingOut], { encoding: 'utf8' });
    expect(written).toBe('real-bytes');
    const attackerContent = execFileSync('cat', [attackerTarget], { encoding: 'utf8' });
    expect(attackerContent).toBe('should-not-be-touched');
  });
});
