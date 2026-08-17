import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Real (non-mocked) containment verification against the actual, already-
 * provisioned exact-release worker — not a throwaway VM, and not the retired
 * per-release M1 Secure-Enclave ceremony. This is normal, repeatable
 * engineering verification: it can run in CI or a maintainer's scheduled
 * suite on any machine that already has a Major Lima worker, and skips
 * cleanly (not "false green") everywhere else.
 */

const LIMACTL = '/opt/homebrew/bin/limactl';

/**
 * Target the ACTIVE worker recorded in execution.json rather than a hardcoded
 * release name. Resource-lifecycle cleanup reclaims per-SHA workers, so a
 * pinned old instance made this real-containment coverage silently skip on
 * maintainer machines — the exact "false green by omission" this file exists to
 * avoid. Fall back to the historical name so nothing regresses where it is
 * still the one present.
 */
function majorHomeDir(): string {
  return process.env.MAJOR_HOME ?? join(homedir(), '.major');
}

function activeInstance(): string {
  try {
    const config = JSON.parse(readFileSync(join(majorHomeDir(), 'execution.json'), 'utf8')) as {
      instance?: string;
    };
    if (typeof config.instance === 'string' && config.instance) return config.instance;
  } catch {
    // fall through
  }
  return 'major-worker-8b33feafe11b';
}

/** Full SHA of the installed release, used to locate its guest release marker. */
function activeReleaseSha(): string {
  try {
    const record = JSON.parse(
      readFileSync(join(majorHomeDir(), 'installed-release.json'), 'utf8'),
    ) as { sha?: string };
    if (typeof record.sha === 'string' && /^[0-9a-f]{40}$/.test(record.sha)) return record.sha;
  } catch {
    // fall through
  }
  return '8b33feafe11b8b5a4ebfd836b455f793a38bc22e';
}

const INSTANCE = activeInstance();
const RELEASE_SHA = activeReleaseSha();

function limactlAvailable(): boolean {
  try {
    const rows = execFileSync(LIMACTL, ['list', '--json'], { encoding: 'utf8', timeout: 10_000 })
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name?: string });
    return rows.some((row) => row.name === INSTANCE);
  } catch {
    return false;
  }
}

const available = limactlAvailable();
let startedHere = false;

function shell(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(LIMACTL, ['shell', '--tty=false', INSTANCE, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/**
 * Assert the guest shell actually works before trusting any containment result.
 *
 * Several checks here assert a NON-zero exit ("provider A cannot read provider
 * B's home"). If `limactl shell` itself is broken -- Lima can report `Running`
 * while its SSH forwarder refuses connections -- those checks pass for the
 * wrong reason while their siblings fail. That is a false green in exactly the
 * file meant to prevent one, so every test states this precondition first.
 */
function requireWorkingShell(): void {
  const probe = shell(['true']);
  expect(
    probe.code,
    `guest shell for ${INSTANCE} is unusable (exit ${probe.code}): ${probe.stderr.trim() || 'no stderr'}. ` +
      'Containment results cannot be trusted until this succeeds; a stop/start cycle usually clears it.',
  ).toBe(0);
}

describe.skipIf(!available)(`real worker containment (${INSTANCE})`, () => {
  beforeAll(() => {
    const status = execFileSync(LIMACTL, ['list', INSTANCE], { encoding: 'utf8' });
    if (!status.includes('Running')) {
      execFileSync(LIMACTL, ['start', INSTANCE], { encoding: 'utf8', timeout: 120_000 });
      startedHere = true;
    }
    // Lima can report Running before (or without) a usable SSH forwarder. One
    // bounded stop/start cycle is the known remedy; do it here so a transient
    // state does not masquerade as a containment result.
    if (shell(['true']).code !== 0) {
      execFileSync(LIMACTL, ['stop', INSTANCE], { encoding: 'utf8', timeout: 60_000 });
      execFileSync(LIMACTL, ['start', INSTANCE], { encoding: 'utf8', timeout: 120_000 });
      startedHere = true;
    }
  }, 200_000);

  afterAll(() => {
    if (startedHere) {
      execFileSync(LIMACTL, ['stop', INSTANCE], { encoding: 'utf8', timeout: 60_000 });
    }
  }, 70_000);

  it('does not mount any host filesystem path into the guest', () => {
    requireWorkingShell();
    const result = shell(['mount']);
    expect(result.code).toBe(0);
    // The hardened template pins mounts: [] — no /Users/... (host home),
    // no host-specific volume names should ever appear in the guest's
    // mount table.
    expect(result.stdout).not.toMatch(/\/Users\//);
    expect(result.stdout).not.toContain('9p');
    expect(result.stdout).not.toContain('virtiofs');
  });

  it("keeps each provider guest user from reading another provider's home", () => {
    requireWorkingShell();
    const providers = ['claude', 'codex', 'cursor', 'antigravity'];
    for (const provider of providers) {
      for (const other of providers) {
        if (provider === other) continue;
        const result = shell([
          'sudo',
          '-n',
          '-u',
          `major-${provider}`,
          'test',
          '-r',
          `/home/major-${other}`,
        ]);
        expect(result.code, `major-${provider} could read /home/major-${other}`).not.toBe(0);
      }
    }
  });

  it('keeps provider-auth credential staging root-only, unreadable by any guest provider user', () => {
    requireWorkingShell();
    for (const provider of ['claude', 'codex', 'cursor', 'antigravity']) {
      const result = shell([
        'sudo',
        '-n',
        '-u',
        `major-${provider}`,
        'test',
        '-r',
        '/var/lib/major/provider-auth',
      ]);
      expect(result.code, `major-${provider} could read /var/lib/major/provider-auth`).not.toBe(0);
    }
  });

  it('has the canonical provider binary present and executable for every provider', () => {
    requireWorkingShell();
    const binaries = [
      '/opt/major/providers/v1/claude/bin/claude',
      '/opt/major/providers/v1/codex/bin/codex-native',
      '/opt/major/providers/v1/cursor/bin/cursor-agent',
      '/opt/major/providers/v1/antigravity/bin/agy',
    ];
    for (const binary of binaries) {
      const result = shell(['test', '-x', binary]);
      expect(result.code, `${binary} is not present/executable`).toBe(0);
    }
  });

  it('has the release marker present, root-owned and immutable-mode', () => {
    requireWorkingShell();
    const result = shell(['sudo', 'stat', '-c', '%U:%G:%a', `/opt/major/releases/${RELEASE_SHA}`]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('root:root:444');
  });
});

describe.skipIf(available)('real worker containment (skipped)', () => {
  it('reports why it skipped rather than silently passing', () => {
    console.log(
      `real-worker-containment.test.ts: SKIPPED — ${INSTANCE} is not available on this machine. ` +
        'This is expected in CI; run on a maintainer machine with the worker provisioned for real coverage.',
    );
    expect(true).toBe(true);
  });
});
