import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darwinSeatbeltContainment, detectContainment } from '../src/security/containment.js';
import type { Containment } from '../src/security/containment.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import {
  ExecutableTrustError,
  TrustedExecutableRegistry,
} from '../src/security/trusted-executables.js';
import {
  ExecutionGateway,
  GatewayViolationError,
  type ExecutionPolicyDecision,
} from '../src/security/gateway.js';
import { trustedExecutableRegistry } from '../src/security/major-gateway.js';
import { gatewayAllowedRoots } from '../src/supervisor/worker.js';

const NODE = process.execPath;

function testContainment(): Containment {
  return {
    enforced: true,
    filesystemIsolation: true,
    networkIsolation: true,
    mechanism: 'test-only',
    detail: 'test-only containment; execution remains capability-gated',
    wrap: (request) => ({ executable: request.executable, args: [...request.args] }),
  };
}

function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'major-cont-')));
}

function writeExecutable(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

function makeGateway(overrides: Partial<ConstructorParameters<typeof ExecutionGateway>[0]> = {}) {
  const decisions: ExecutionPolicyDecision[] = [];
  const root = (overrides.allowedRoots?.[0] as string) ?? tempDir();
  const registry = new TrustedExecutableRegistry();
  registry.pin(NODE);
  const gateway = new ExecutionGateway({
    allowedRoots: [root],
    commandPolicy: { allowedExecutables: ['node'] },
    trustedExecutables: registry,
    baseEnv: { PATH: process.env.PATH ?? '' },
    recordDecision: (d) => decisions.push(d),
    containment: testContainment(),
    ...overrides,
  });
  return { gateway, decisions, root, registry };
}

describe('executable trust does not come from inherited PATH ordering (M1 groundwork)', () => {
  it('discovery only trusts binaries in supervisor-controlled directories', () => {
    const evilDir = tempDir();
    const goodDir = tempDir();
    writeExecutable(evilDir, 'tool', '#!/bin/sh\necho evil\n');
    const good = writeExecutable(goodDir, 'tool', '#!/bin/sh\necho good\n');

    // hostile ordering: evil dir first on PATH
    const registry = new TrustedExecutableRegistry({ allowedDirs: [goodDir] });
    const trusted = registry.discover('tool', `${evilDir}:${goodDir}`);
    expect(trusted?.canonicalPath).toBe(realpathSync(good));

    // with no supervisor-controlled directory, PATH discovery trusts nothing
    expect(
      new TrustedExecutableRegistry().discover('tool', `${evilDir}:${goodDir}`),
    ).toBeUndefined();
  });
});

describe('executable identity revalidation', () => {
  it('refuses a same-basename replacement / in-place mutation after trust', () => {
    const dir = tempDir();
    const tool = writeExecutable(dir, 'tool', '#!/bin/sh\necho original\n');
    const registry = new TrustedExecutableRegistry({ allowedDirs: [dir] });
    registry.pin(tool);
    expect(registry.verify('tool').canonicalPath).toBe(realpathSync(tool));

    // the binary is swapped for a different one at the same path
    writeExecutable(dir, 'tool', '#!/bin/sh\necho TROJAN payload with more bytes\n');
    expect(() => registry.verify('tool')).toThrow(ExecutableTrustError);
    expect(() => registry.verify(tool)).toThrow(ExecutableTrustError);
  });

  it('rehashes content when an attacker preserves inode, size and mtime', () => {
    const dir = tempDir();
    const original = '#!/bin/sh\necho ORIGINAL\n';
    const changed = '#!/bin/sh\necho TAMPERED\n';
    expect(changed).toHaveLength(original.length);
    const tool = writeExecutable(dir, 'tool', original);
    const fixedTime = new Date(Math.floor(Date.now() / 1000) * 1000);
    utimesSync(tool, fixedTime, fixedTime);
    const registry = new TrustedExecutableRegistry({ allowedDirs: [dir] });
    registry.pin(tool);
    const before = statSync(tool);

    writeFileSync(tool, changed);
    chmodSync(tool, 0o755);
    utimesSync(tool, before.atime, before.mtime);
    const after = statSync(tool);
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(() => registry.verify('tool')).toThrow(/content/);
  });
});

describe('production gateway trust composition', () => {
  it('does not promote an arbitrary PATH binary into a pinned executable', () => {
    const evilDir = tempDir();
    writeExecutable(evilDir, 'major-shadow-probe', '#!/bin/sh\necho spawned\n');
    const priorPath = process.env.PATH;
    process.env.PATH = `${evilDir}:${priorPath ?? ''}`;
    try {
      expect(() => trustedExecutableRegistry('major-shadow-probe')).toThrow(
        /cannot trust|not resolvable/,
      );
    } finally {
      if (priorPath === undefined) delete process.env.PATH;
      else process.env.PATH = priorPath;
    }
  });
});

describe('containment status is reported honestly', () => {
  it('reports readiness only when the macOS Seatbelt executable is present', () => {
    const status = detectContainment();
    const expected = platform() === 'darwin' && existsSync('/usr/bin/sandbox-exec');
    expect(status.filesystemIsolation).toBe(expected);
    expect(status.networkIsolation).toBe(expected);
    expect(status.liveExecutionReady).toBe(expected);
  });

  it('fails closed when the platform has no supported OS sandbox', () => {
    const containment = darwinSeatbeltContainment('linux');
    expect(containment.enforced).toBe(false);
    expect(() =>
      containment.wrap({
        executable: NODE,
        canonicalExecutable: realpathSync(NODE),
        args: [],
        allowedRoots: [tempDir()],
      }),
    ).toThrow(/unavailable/);
  });
});

describe.runIf(platform() === 'darwin')('macOS Seatbelt integration', () => {
  it('allows the declared root and denies sibling reads, writes and descendant escapes', () => {
    const allowed = tempDir();
    const readOnly = tempDir();
    const denied = tempDir();
    const allowedMarker = join(allowed, 'allowed.txt');
    const deniedMarker = join(denied, 'denied.txt');
    const dataVolumeMarker = `/System/Volumes/Data${deniedMarker}`;
    const systemConfigMarker = '/etc/hosts';
    writeFileSync(deniedMarker, 'private');
    expect(existsSync(dataVolumeMarker)).toBe(true);
    const readOnlyMarker = join(readOnly, 'provider-runtime.json');
    writeFileSync(readOnlyMarker, 'read-only');
    const descendantMarker = join(denied, 'descendant.txt');
    const containment = darwinSeatbeltContainment();
    const script = [
      "const fs=require('node:fs')",
      "const cp=require('node:child_process')",
      `fs.writeFileSync(${JSON.stringify(allowedMarker)}, 'ok')`,
      `const readOnlyValue=fs.readFileSync(${JSON.stringify(readOnlyMarker)}, 'utf8')`,
      `let readOnlyWriteDenied=false; try { fs.writeFileSync(${JSON.stringify(readOnlyMarker)}, 'bad') } catch { readOnlyWriteDenied=true }`,
      `fs.writeFileSync('/dev/null', 'discarded')`,
      `let readDenied=false; try { fs.readFileSync(${JSON.stringify(deniedMarker)}) } catch { readDenied=true }`,
      `let writeDenied=false; try { fs.writeFileSync(${JSON.stringify(deniedMarker)}, 'bad') } catch { writeDenied=true }`,
      `let systemConfigReadDenied=false; try { fs.readFileSync(${JSON.stringify(systemConfigMarker)}) } catch { systemConfigReadDenied=true }`,
      `let dataVolumeReadDenied=false; try { fs.readFileSync(${JSON.stringify(dataVolumeMarker)}) } catch { dataVolumeReadDenied=true }`,
      `const certificateReadable=fs.readFileSync('/etc/ssl/cert.pem').length>0`,
      `const child=cp.spawnSync(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(descendantMarker)}, 'bad')`)}])`,
      'process.stdout.write(JSON.stringify({readOnlyValue,readOnlyWriteDenied,readDenied,writeDenied,systemConfigReadDenied,dataVolumeReadDenied,certificateReadable,childFailed:child.status!==0}))',
    ].join(';');
    const wrapped = containment.wrap({
      executable: NODE,
      canonicalExecutable: realpathSync(NODE),
      args: ['-e', script],
      allowedRoots: [allowed],
      readOnlyRoots: [readOnly],
    });
    const result = spawnSync(wrapped.executable, wrapped.args, {
      cwd: allowed,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      readOnlyValue: 'read-only',
      readOnlyWriteDenied: true,
      readDenied: true,
      writeDenied: true,
      systemConfigReadDenied: true,
      dataVolumeReadDenied: true,
      certificateReadable: true,
      childFailed: true,
    });
    expect(existsSync(allowedMarker)).toBe(true);
    expect(existsSync(descendantMarker)).toBe(false);
    expect(readFileSync(deniedMarker, 'utf8')).toBe('private');
  });

  it('allows a linked worktree to update only its external Git common directory', () => {
    const parent = tempDir();
    const main = join(parent, 'main');
    const worktree = join(parent, 'worktree');
    for (const args of [
      ['init', '--initial-branch=main', main],
      ['-C', main, 'config', 'user.name', 'Major Test'],
      ['-C', main, 'config', 'user.email', 'major@example.invalid'],
    ]) {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(join(main, 'seed.txt'), 'seed\n');
    for (const args of [
      ['-C', main, 'add', 'seed.txt'],
      ['-C', main, 'commit', '-m', 'seed'],
      ['-C', main, 'worktree', 'add', '-b', 'test-worktree', worktree],
    ]) {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(join(worktree, 'marker.txt'), 'contained\n');

    const git = realpathSync('/usr/bin/git');
    const wrapped = darwinSeatbeltContainment().wrap({
      executable: git,
      canonicalExecutable: git,
      args: ['add', 'marker.txt'],
      allowedRoots: gatewayAllowedRoots(worktree),
    });
    const result = spawnSync(wrapped.executable, wrapped.args, {
      cwd: worktree,
      encoding: 'utf8',
      env: {
        HOME: worktree,
        TMPDIR: worktree,
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const status = spawnSync('git', ['-C', worktree, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    expect(status.stdout).toContain('A  marker.txt');
  }, 30_000);
});

describe('M1-disabled execution remains fail-closed', () => {
  it('refuses argv paths outside the allowed roots', () => {
    const { gateway, decisions, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1', '/etc/shadow'], cwd: root }),
    ).toThrow(CapabilityUnavailableError);
    expect(decisions.at(-1)?.allowed).toBe(false);
  });

  it('refuses when no containment is configured', () => {
    const root = tempDir();
    const registry = new TrustedExecutableRegistry();
    registry.pin(NODE);
    const gateway = new ExecutionGateway({
      allowedRoots: [root],
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: registry,
      baseEnv: { PATH: process.env.PATH ?? '' },
      recordDecision: () => undefined,
    });
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
  });
});
