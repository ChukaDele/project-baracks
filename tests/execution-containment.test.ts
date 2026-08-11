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
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import {
  darwinSeatbeltContainment,
  detectContainment,
  processTreeContainment,
} from '../src/security/containment.js';
import {
  ExecutableTrustError,
  TrustedExecutableRegistry,
} from '../src/security/trusted-executables.js';
import { ExecutionGateway, type ExecutionPolicyDecision } from '../src/security/gateway.js';

const NODE = process.execPath;

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
    containment: processTreeContainment(),
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
    const denied = tempDir();
    const allowedMarker = join(allowed, 'allowed.txt');
    const deniedMarker = join(denied, 'denied.txt');
    writeFileSync(deniedMarker, 'private');
    const descendantMarker = join(denied, 'descendant.txt');
    const containment = darwinSeatbeltContainment();
    const script = [
      "const fs=require('node:fs')",
      "const cp=require('node:child_process')",
      `fs.writeFileSync(${JSON.stringify(allowedMarker)}, 'ok')`,
      `let readDenied=false; try { fs.readFileSync(${JSON.stringify(deniedMarker)}) } catch { readDenied=true }`,
      `let writeDenied=false; try { fs.writeFileSync(${JSON.stringify(deniedMarker)}, 'bad') } catch { writeDenied=true }`,
      `const child=cp.spawnSync(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(descendantMarker)}, 'bad')`)}])`,
      'process.stdout.write(JSON.stringify({readDenied,writeDenied,childFailed:child.status!==0}))',
    ].join(';');
    const wrapped = containment.wrap({
      executable: NODE,
      canonicalExecutable: realpathSync(NODE),
      args: ['-e', script],
      allowedRoots: [allowed],
    });
    const result = spawnSync(wrapped.executable, wrapped.args, {
      cwd: allowed,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      readDenied: true,
      writeDenied: true,
      childFailed: true,
    });
    expect(existsSync(allowedMarker)).toBe(true);
    expect(existsSync(descendantMarker)).toBe(false);
    expect(readFileSync(deniedMarker, 'utf8')).toBe('private');
  });
});

describe('execution is unreachable through the gateway in this build', () => {
  it('refuses before containment, trust or path checks could even run', () => {
    const { gateway, decisions, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1', '/etc/shadow'], cwd: root }),
    ).toThrow(CapabilityUnavailableError);
    expect(decisions.at(-1)?.allowed).toBe(false);
  });

  it('refuses identically with no containment configured (still fail-closed)', () => {
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
