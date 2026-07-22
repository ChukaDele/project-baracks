import { chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processTreeContainment } from '../src/security/containment.js';
import {
  ExecutableTrustError,
  TrustedExecutableRegistry,
} from '../src/security/trusted-executables.js';
import {
  ExecutionGateway,
  GatewayViolationError,
  type ExecutionPolicyDecision,
} from '../src/security/gateway.js';

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

describe('P1-1 executable trust does not come from inherited PATH ordering', () => {
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

describe('P1-1 stable executable identity revalidated at the spawn boundary', () => {
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

describe('P1-1 gateway confines path-bearing arguments to allowed roots', () => {
  it('refuses an absolute path argument outside the allowed roots', () => {
    const { gateway, decisions, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1', '/etc/shadow'], cwd: root }),
    ).toThrow(GatewayViolationError);
    // recorded refusal
    expect(decisions.at(-1)?.allowed).toBe(false);
  });

  it('refuses a tool directory flag pointing outside the roots', () => {
    const { gateway, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-C', '/etc', '-e', '1'], cwd: root }),
    ).toThrow(/path|root/i);
  });

  it('allows a path argument that stays inside a root', async () => {
    const { gateway, root } = makeGateway();
    const outcome = await gateway.execute({
      executable: NODE,
      args: ['-e', 'process.exit(0)', join(root, 'inside.txt')],
      cwd: root,
    }).outcome;
    expect(outcome.status).toBe('succeeded');
  });
});

describe('P1-1 containment is required and applied to the whole process tree', () => {
  it('fails closed when no containment is configured (unsupported platform)', () => {
    const root = tempDir();
    const registry = new TrustedExecutableRegistry();
    registry.pin(NODE);
    // A gateway with NO containment configured (as on an unsupported platform).
    const gateway = new ExecutionGateway({
      allowedRoots: [root],
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: registry,
      baseEnv: { PATH: process.env.PATH ?? '' },
      recordDecision: () => undefined,
    });
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      /containment/i,
    );
  });

  it('terminates the entire spawned process tree, not only the direct child', async () => {
    const root = tempDir();
    const marker = join(root, 'grandchild-survived.txt');
    const { gateway } = makeGateway({ allowedRoots: [root] });
    // Parent stays alive and spawns a (same-group) grandchild that writes a
    // marker after a delay. Cancelling must kill the whole group before it
    // writes. The marker path is inlined because the sanitised env strips it.
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 700)`;
    const source = `
      const { spawn } = require('node:child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
      setTimeout(() => {}, 5000);
    `;
    const handle = gateway.execute({ executable: NODE, args: ['-e', source], cwd: root });
    await new Promise((r) => setTimeout(r, 150));
    handle.cancel();
    await handle.outcome;
    await new Promise((r) => setTimeout(r, 900));
    expect(existsSync(marker)).toBe(false);
  });
});
