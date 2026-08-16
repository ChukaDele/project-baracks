import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * scripts/major-beta-install.sh deliberately reuses install-major-runtime.sh
 * for everything past "obtain a verified source checkout" — the actual
 * build/release-gate/worker-provisioning/atomic-activation pipeline is
 * already covered by that script's own tests. What's new and testable here
 * without a real HTTPS git remote is exactly the pre-network guard logic:
 * HTTPS enforcement on both URLs, and the compatibility preflight (OS,
 * required tools, Lima version) that must all pass BEFORE any clone is
 * attempted. The post-clone pinned-sha mismatch check is two lines of plain
 * string comparison exercised only via a real HTTPS manifest server, which
 * this suite intentionally does not stand up (self-signed-cert test
 * infrastructure for that narrow a check is disproportionate here); it is
 * covered by review, not execution.
 */

const SCRIPT = resolve('scripts/major-beta-install.sh');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    execFileSync('rm', ['-rf', root]);
  }
});

function fakeBin(name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'major-beta-install-'));
  roots.push(root);
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return root;
}

/** A minimal PATH containing only symlinks to the given real tools, plus any
 * extra fake-bin directories layered in front — deterministic regardless of
 * what else happens to be on the host's real PATH. */
function minimalPath(realTools: string[], extraDirsFirst: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'major-beta-install-path-'));
  roots.push(root);
  for (const tool of realTools) {
    const real = execFileSync('command', ['-v', tool], {
      shell: '/bin/sh',
      encoding: 'utf8',
    }).trim();
    symlinkSync(real, join(root, tool));
  }
  return [...extraDirsFirst, root].join(':');
}

function run(env: Record<string, string>): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('/bin/bash', [SCRIPT], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// Every tool the script's own preflight checks for, so filtering one out of
// this list is exactly "that one tool is missing" -- not also missing
// whatever this list forgot to include.
const ALL_TOOLS = [
  'git',
  'node',
  'curl',
  'python3',
  'corepack',
  'limactl',
  'uname',
  'command',
  'grep',
  'mktemp',
  'rm',
];

describe('major-beta-install.sh (pre-network guards)', () => {
  it('refuses a non-https MAJOR_REPO_URL before touching the network', () => {
    const result = run({
      PATH: minimalPath(ALL_TOOLS),
      MAJOR_REPO_URL: 'http://example.invalid/project-baracks.git',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be an https:\/\/ URL/);
  });

  it('refuses a non-https MAJOR_RELEASE_MANIFEST_URL before touching the network', () => {
    const result = run({
      PATH: minimalPath(ALL_TOOLS),
      MAJOR_RELEASE_MANIFEST_URL: 'http://example.invalid/manifest.json',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/must be an https:\/\/ URL/);
  });

  it('refuses to run on a non-macOS platform', () => {
    const fakeUname = fakeBin('uname', 'echo Linux');
    const result = run({ PATH: `${fakeUname}:${minimalPath(ALL_TOOLS)}` });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/macOS only/);
  });

  it('refuses when a required tool is missing from PATH, naming exactly that tool', () => {
    const result = run({ PATH: minimalPath(ALL_TOOLS.filter((t) => t !== 'python3')) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      'ERROR: missing required tools on PATH: python3\nInstall them, then re-run this script.\n',
    );
  });

  it('refuses when neither corepack nor pnpm is present', () => {
    const result = run({ PATH: minimalPath(ALL_TOOLS.filter((t) => t !== 'corepack')) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/neither corepack nor pnpm/);
  });

  it('refuses when the installed Lima version is outside the supported range', () => {
    const fakeLimactl = fakeBin('limactl', 'echo "limactl version 3.0.0"');
    const result = run({
      PATH: `${fakeLimactl}:${minimalPath(ALL_TOOLS.filter((t) => t !== 'limactl'))}`,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Lima >=2\.2\.0/);
  });

  it('passes preflight and reaches the clone step once everything is present', () => {
    // No real HTTPS git server is stood up for this suite (see file
    // docstring) -- proving control reaches `git clone` is enough to show
    // every guard above it passed; the clone itself fails against a
    // deliberately unreachable host, which is the expected outcome here.
    const fakeLimactl = fakeBin('limactl', 'echo "limactl version 2.2.4"');
    const result = run({
      PATH: `${fakeLimactl}:${minimalPath(ALL_TOOLS.filter((t) => t !== 'limactl'))}`,
      MAJOR_REPO_URL: 'https://127.0.0.1.invalid.example/does-not-exist.git',
      HOME: mkdtempSync(join(tmpdir(), 'major-beta-install-home-')),
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/Preflight OK/);
    expect(result.stdout).toMatch(/Cloning/);
    expect(result.stderr).not.toMatch(/must be an https|macOS only|missing required|Lima >=/);
  });
});
