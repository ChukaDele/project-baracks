import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { detectContainment, processTreeContainment } from '../src/security/containment.js';
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

describe('executable identity revalidation (M1 groundwork, known-incomplete)', () => {
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
});

describe('containment status is reported honestly', () => {
  it('never reports live-execution readiness (no OS filesystem sandbox exists)', () => {
    const status = detectContainment();
    expect(status.filesystemIsolation).toBe(false);
    expect(status.liveExecutionReady).toBe(false);
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
