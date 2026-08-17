import { linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This module's darwin-Keychain fallback is otherwise untestable in CI: the
// real `security` CLI reflects whatever the machine running the tests
// actually has authenticated, and CI runners aren't darwin at all. Mocking
// both keeps the test deterministic and portable while exercising the real
// branching logic (not a re-implementation of it).
const execFileSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => 'darwin' };
});

const { checkHostCredential, fingerprintCredentialFile } =
  await import('../src/providers/host-credential.js');

let home = '';
let priorHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'major-host-credential-'));
  priorHome = process.env.HOME;
  process.env.HOME = home;
  execFileSyncMock.mockReset();
  // Default: no Keychain entry for anything (find-generic-password exits non-zero).
  execFileSyncMock.mockImplementation(() => {
    throw new Error('security: could not be found in the keychain');
  });
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
});

describe('checkHostCredential', () => {
  it('reports not-found when neither a flat file nor a Keychain entry exists (claude)', () => {
    const result = checkHostCredential('claude');
    expect(result.status).toBe('not-found');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials'],
      expect.anything(),
    );
  });

  it('falls back to a Keychain-authenticated report for Claude when the flat file is absent but a Keychain entry exists', () => {
    execFileSyncMock.mockImplementation(() => '');
    const result = checkHostCredential('claude');
    expect(result.status).toBe('unsafe');
    expect(result.detail).toMatch(/Keychain/);
    expect(result.detail).toMatch(/Claude Code/);
  });

  it('falls back to a Keychain-authenticated report for Cursor when the flat file is absent but a Keychain entry exists', () => {
    execFileSyncMock.mockImplementation((bin: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv[argv.indexOf('-s') + 1] === 'cursor-access-token') return '';
      throw new Error('not found');
    });
    const result = checkHostCredential('cursor');
    expect(result.status).toBe('unsafe');
    expect(result.detail).toMatch(/Keychain/);
    expect(result.detail).toMatch(/Cursor/);
  });

  it('reports found for a well-formed flat-file credential (codex) without ever checking Keychain', () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    const path = join(home, '.codex', 'auth.json');
    writeFileSync(path, JSON.stringify({ token: 'x' }));
    const result = checkHostCredential('codex');
    expect(result).toEqual({ status: 'found', path, detail: `found at ${path}` });
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('prefers a present flat file over the Keychain fallback for Claude', () => {
    execFileSyncMock.mockImplementation(() => '');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ token: 'x' }));
    const result = checkHostCredential('claude');
    expect(result.status).toBe('found');
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects a symlinked credential file even when the target is well-formed', () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    const target = join(home, '.codex', 'real.json');
    writeFileSync(target, JSON.stringify({ token: 'x' }));
    symlinkSync(target, join(home, '.codex', 'auth.json'));
    const result = checkHostCredential('codex');
    expect(result).toMatchObject({ status: 'unsafe' });
    expect(result.detail).toMatch(/symlink/);
  });

  it('rejects a credential file with more than one hard link', () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    const original = join(home, '.codex', 'other.json');
    writeFileSync(original, JSON.stringify({ token: 'x' }));
    linkSync(original, join(home, '.codex', 'auth.json'));
    const result = checkHostCredential('codex');
    expect(result).toMatchObject({ status: 'unsafe' });
    expect(result.detail).toMatch(/hard link/);
  });

  it('rejects malformed JSON and empty-object credential shapes', () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    const path = join(home, '.codex', 'auth.json');
    writeFileSync(path, 'not json');
    expect(checkHostCredential('codex')).toMatchObject({ status: 'unsafe' });
    writeFileSync(path, '{}');
    expect(checkHostCredential('codex')).toMatchObject({ status: 'unsafe' });
  });

  it('reports antigravity as having no known host credential location, without checking Keychain', () => {
    const result = checkHostCredential('antigravity');
    expect(result).toEqual({
      status: 'not-found',
      detail: 'no known host credential location for antigravity on this platform',
    });
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

describe('fingerprintCredentialFile', () => {
  it('produces a stable, non-reversible digest that changes when the file changes', () => {
    const path = join(home, 'cred.json');
    writeFileSync(path, JSON.stringify({ token: 'alpha' }));
    const first = fingerprintCredentialFile(path);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('alpha');
    writeFileSync(path, JSON.stringify({ token: 'beta' }));
    expect(fingerprintCredentialFile(path)).not.toBe(first);
  });
});
