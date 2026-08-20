import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkArgv } from '../src/security/commands.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';

// 'M1 execution gateway release gate' and the capability-gate assertion in
// 'policy decision audit trail' below exercise ExecutionGateway's own
// pre-activation defense-in-depth ordering, independent of this build's real
// (now active) live-agent-execution state — see
// tests/activated-capabilities.test.ts for the real-value assertion.
vi.mock('../src/security/capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/security/capabilities.js')>();
  const isCapabilityAvailable = (capability: string) =>
    capability === 'live-agent-execution'
      ? false
      : actual.isCapabilityAvailable(capability as never);
  return {
    ...actual,
    isCapabilityAvailable,
    // Reimplemented against the override above: assertCapabilityAvailable's
    // real body closes over the real module's own isCapabilityAvailable, so
    // spreading actual.assertCapabilityAvailable here would silently ignore
    // this mock.
    assertCapabilityAvailable: (capability: string) => {
      if (!isCapabilityAvailable(capability)) {
        throw new actual.CapabilityUnavailableError(capability as never);
      }
    },
  };
});
import type { ExecutionBackend } from '../src/execution/backend.js';
import type { Containment } from '../src/security/containment.js';
import { verifyProviderApprovalAuthority } from '../src/security/provider-approval-policy.js';
import { BILLING_ENV_NAMES, sanitizeEnv } from '../src/security/env.js';
import {
  ExecutionGateway,
  GatewayViolationError,
  type ExecutionPolicyDecision,
} from '../src/security/gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';

const NODE = process.execPath;

function testContainment(): Containment {
  return {
    enforced: true,
    filesystemIsolation: true,
    networkIsolation: true,
    mechanism: 'test-only',
    detail: 'test-only containment for gateway policy tests',
    wrap: (request) => ({ executable: request.executable, args: [...request.args] }),
  };
}

function tempRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'major-gw-')));
}

/** A registry that already trusts the real node binary under the name 'node'. */
function trustingNode(): TrustedExecutableRegistry {
  const registry = new TrustedExecutableRegistry();
  registry.pin(NODE);
  return registry;
}

/** A fully configured test gateway with a pinned executable and containment. */
function makeGateway(overrides: Partial<ConstructorParameters<typeof ExecutionGateway>[0]> = {}) {
  const decisions: ExecutionPolicyDecision[] = [];
  const root = overrides.allowedRoots?.[0] ?? tempRoot();
  const gateway = new ExecutionGateway({
    allowedRoots: [root],
    commandPolicy: { allowedExecutables: ['node', 'git', 'which'] },
    trustedExecutables: trustingNode(),
    baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    recordDecision: (d) => decisions.push(d),
    containment: testContainment(),
    ...overrides,
  });
  return { gateway, decisions, root };
}

describe('execution gateway construction', () => {
  it('requires non-empty allowed roots', () => {
    expect(
      () =>
        new ExecutionGateway({
          allowedRoots: [],
          commandPolicy: { allowedExecutables: ['node'] },
          trustedExecutables: new TrustedExecutableRegistry(),
          recordDecision: () => undefined,
        }),
    ).toThrow(GatewayViolationError);
  });

  it('requires a non-empty executable allowlist', () => {
    expect(
      () =>
        new ExecutionGateway({
          allowedRoots: [tempRoot()],
          commandPolicy: {},
          trustedExecutables: new TrustedExecutableRegistry(),
          recordDecision: () => undefined,
        }),
    ).toThrow(GatewayViolationError);
  });

  it('requires a trusted-executable registry', () => {
    expect(
      () =>
        new ExecutionGateway({
          allowedRoots: [tempRoot()],
          commandPolicy: { allowedExecutables: ['node'] },
          recordDecision: () => undefined,
        } as never),
    ).toThrow(/trustedExecutables/);
  });
});

describe('M1 execution gateway release gate', () => {
  it('refuses a trusted command before spawn and records the decision', () => {
    const { gateway, decisions, root } = makeGateway();
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'execute', allowed: false });
  });

  it('keeps a probe-only gateway non-executable and records the refusal', () => {
    const decisions: ExecutionPolicyDecision[] = [];
    const gateway = ExecutionGateway.probeOnly({
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: new TrustedExecutableRegistry(),
      recordDecision: (d) => decisions.push(d),
    });
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: process.cwd() }),
    ).toThrow(CapabilityUnavailableError);
    expect(decisions[0]!.allowed).toBe(false);
    expect(gateway.resolveExecutable('node')).toBeDefined();
  });

  it('does not reach a claimed containment implementation while M1 is closed', () => {
    let wrapCalled = false;
    const { gateway, root } = makeGateway({
      containment: {
        enforced: true,
        filesystemIsolation: true,
        networkIsolation: true,
        mechanism: 'claimed-sandbox',
        detail: 'a configuration claim, not enforcement',
        wrap() {
          wrapCalled = true;
          throw new Error('claimed containment failed');
        },
      },
    });
    expect(() => gateway.execute({ executable: 'node', args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
    expect(wrapCalled).toBe(false);
  });
});

describe('trusted canonical executable registry (M1 groundwork, probe-side)', () => {
  it('discovery trusts only the PATH-resolved binary; re-binding to another is refused', () => {
    const fakeDir = tempRoot();
    const registry = new TrustedExecutableRegistry({ allowedDirs: [fakeDir] });
    const fake = join(fakeDir, 'mytool');
    writeFileSync(fake, '#!/bin/sh\necho fake\n');
    chmodSync(fake, 0o755);
    const trusted = registry.discover('mytool', fakeDir);
    expect(trusted?.canonicalPath).toBe(realpathSync(fake));

    const otherDir = tempRoot();
    const other = join(otherDir, 'mytool');
    writeFileSync(other, '#!/bin/sh\necho other\n');
    chmodSync(other, 0o755);
    expect(() => registry.trust('mytool', other, 'pinned')).toThrow(/refusing to re-bind/);
  });
});

describe('argv command policy (pure, retained for M1)', () => {
  it('refuses force pushes and pushes to protected branches, however spelled', () => {
    const policy = { allowedExecutables: ['git'], protectedBranches: ['main', 'master'] };
    expect(checkArgv('git', ['push', '--force', 'origin', 'x'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['push', '-f', 'origin', 'x'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['push', '--force-with-lease=x', 'origin', 'x'], policy).allowed).toBe(
      false,
    );
    expect(checkArgv('git', ['push', 'origin', 'main'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['push', 'origin', 'HEAD:main'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['push', 'origin', 'refs/heads/master'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['-C', '/somewhere', 'push', 'origin', 'main'], policy).allowed).toBe(
      false,
    );
    // bare push could hit a protected branch via tracking config
    expect(checkArgv('git', ['push'], policy).allowed).toBe(false);
    expect(checkArgv('git', ['push', 'origin', 'feature/x'], policy).allowed).toBe(true);
    expect(checkArgv('git', ['status'], policy).allowed).toBe(true);
  });

  it('refuses destructive filesystem and database commands', () => {
    const policy = { allowedExecutables: ['rm', 'sqlite3', 'find'] };
    expect(checkArgv('rm', ['-rf', '/tmp/x'], policy).allowed).toBe(false);
    expect(checkArgv('rm', ['-fr', '/tmp/x'], policy).allowed).toBe(false);
    expect(checkArgv('rm', ['-r', '-f', '/tmp/x'], policy).allowed).toBe(false);
    expect(checkArgv('rm', ['--recursive', '--force', 'x'], policy).allowed).toBe(false);
    expect(checkArgv('rm', ['file.txt'], policy).allowed).toBe(true);
    expect(checkArgv('sqlite3', ['app.db', 'DROP TABLE users'], policy).allowed).toBe(false);
    expect(checkArgv('sqlite3', ['app.db', 'TRUNCATE audit'], policy).allowed).toBe(false);
    expect(checkArgv('sqlite3', ['app.db', 'SELECT 1'], policy).allowed).toBe(true);
  });

  it('refuses shell command strings', () => {
    const policy = { allowedExecutables: ['bash', 'sh'] };
    expect(checkArgv('bash', ['-c', 'rm -rf /'], policy).allowed).toBe(false);
    expect(checkArgv('sh', ['-lc', 'echo hi'], policy).allowed).toBe(false);
  });

  it('requires the allowlist to be present and non-empty', () => {
    expect(checkArgv('git', ['status'], { allowedExecutables: [] }).allowed).toBe(false);
    expect(checkArgv('git', ['status'], {}).allowed).toBe(false);
  });
});

describe('environment sanitisation (pure, retained for M1)', () => {
  it('strips API keys, billing toggles and secret-shaped variables', () => {
    const { env, stripped } = sanitizeEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      ANTHROPIC_API_KEY: 'sk-ant-xyz',
      OPENAI_API_KEY: 'sk-xyz',
      CLAUDE_CODE_USE_BEDROCK: '1',
      GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
      MY_SERVICE_TOKEN: 'tok',
      AWS_SECRET_ACCESS_KEY: 'aws',
      RANDOM_VAR: 'not allowlisted either',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
    for (const name of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'MY_SERVICE_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
    ]) {
      expect(stripped).toContain(name);
    }
  });

  it('covers every known billing-related variable', () => {
    const source = Object.fromEntries(BILLING_ENV_NAMES.map((n) => [n, 'v']));
    const { env, stripped } = sanitizeEnv(source);
    expect(Object.keys(env)).toHaveLength(0);
    expect(stripped).toEqual([...BILLING_ENV_NAMES].sort());
  });
});

describe('policy decision audit trail', () => {
  it('redacts secrets in recorded argv', () => {
    const { gateway, root, decisions } = makeGateway();
    try {
      gateway.execute({
        executable: 'curl',
        args: ['-H', 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456'],
        cwd: root,
      });
    } catch {
      // expected refusal
    }
    expect(decisions).toHaveLength(1);
    expect(JSON.stringify(decisions)).not.toContain('ghp_abcdef');
  });

  it('records denied execution and allowed probe decisions in the append-only audit table', async () => {
    const { testDb } = await import('./helpers.js');
    const { dbDecisionRecorder } = await import('../src/security/audit.js');
    const { executionPolicyDecisions } = await import('../src/db/schema.js');
    const db = testDb();
    const root = tempRoot();
    const gateway = new ExecutionGateway({
      allowedRoots: [root],
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: trustingNode(),
      baseEnv: { PATH: process.env.PATH ?? '' },
      recordDecision: dbDecisionRecorder(db),
      containment: testContainment(),
    });
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1', '/etc/shadow'], cwd: root }),
    ).toThrow(CapabilityUnavailableError);
    gateway.resolveExecutable('node');
    const rows = db.select().from(executionPolicyDecisions).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.allowed)).toEqual([false, true]);
    expect(() => db.delete(executionPolicyDecisions).run()).toThrow(/append-only/);
  });
});

describe('discovery resolution (process-free, no subprocess)', () => {
  it('resolves an allowlisted name on PATH for reporting and records it', () => {
    const { gateway, decisions } = makeGateway();
    const resolved = gateway.resolveExecutable('node');
    expect(resolved).toContain('node');
    expect(decisions[0]).toMatchObject({ kind: 'probe', allowed: true });
    // Resolution is reporting-only: it carries no argv (nothing is executed).
    expect(decisions[0]!.argv).toEqual([]);
  });

  it('refuses a path-qualified target and any name off the discovery allowlist', () => {
    const { gateway } = makeGateway();
    // A path-qualified (environment/PATH-selected) override cannot be resolved.
    expect(() => gateway.resolveExecutable('/tmp/evil/node')).toThrow(GatewayViolationError);
    // Names outside the allowlist are refused outright.
    expect(() => gateway.resolveExecutable('rm')).toThrow(GatewayViolationError);
  });
});

function fakeLimaBackend(onExecute: () => void): ExecutionBackend {
  return {
    kind: 'lima',
    inspect: async () => ({
      kind: 'lima',
      available: true,
      filesystemIsolation: true,
      networkIsolation: true,
      lifecycleIsolation: true,
      detail: 'test backend',
    }),
    probeProvider: async () => ({
      executable: 'codex',
      installed: false,
      authenticated: false,
      detail: 'test backend',
    }),
    readCodexUsage: async () => [],
    execute: () => {
      onExecute();
      return {
        events: (async function* () {})(),
        cancel() {},
        outcome: Promise.resolve({
          status: 'succeeded',
          exitCode: 0,
          rateLimited: false,
          exhausted: false,
        }),
      };
    },
  };
}

describe('Codex guest mutation gateway boundary', () => {
  const workshopAuthority = {
    kind: 'supervised_workshop' as const,
    attachmentId: 'attach',
    sessionId: 'session',
    project: 'demo',
    repoPath: '/tmp/demo',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  it('refuses Codex mutation through host containment even with Workshop authority', () => {
    const { gateway, root } = makeGateway({
      commandPolicy: { allowedExecutables: ['codex'] },
      verifyProviderDecision: () => true,
    });
    expect(() =>
      gateway.execute({
        executable: 'codex',
        args: ['exec'],
        cwd: root,
        executionAuthority: workshopAuthority,
        providerRequest: {
          host: 'codex',
          prompt: 'mutate',
          allowGuestMutation: true,
          workspaceHash: 'a'.repeat(64),
          approvalAuthority: verifyProviderApprovalAuthority(
            'codex',
            { decisions: [] },
            () => true,
          ),
        },
      }),
    ).toThrow(/Lima execution backend/);
  });

  it('refuses Codex mutation on the Lima backend without a source digest', () => {
    const { gateway, root } = makeGateway({
      commandPolicy: { allowedExecutables: ['codex'] },
      backend: fakeLimaBackend(() => {
        throw new Error('backend must not run');
      }),
      verifyProviderDecision: () => true,
    });
    expect(() =>
      gateway.execute({
        executable: 'codex',
        args: ['exec'],
        cwd: root,
        executionAuthority: workshopAuthority,
        providerRequest: {
          host: 'codex',
          prompt: 'mutate',
          allowGuestMutation: true,
          approvalAuthority: verifyProviderApprovalAuthority(
            'codex',
            { decisions: [] },
            () => true,
          ),
        },
      }),
    ).toThrow(/source workspace digest/);
  });

  it('admits Codex mutation through Lima after Workshop authority and a source digest', () => {
    let executed = false;
    const { gateway, root } = makeGateway({
      commandPolicy: { allowedExecutables: ['codex'] },
      backend: fakeLimaBackend(() => {
        executed = true;
      }),
      verifyProviderDecision: () => true,
    });
    gateway.execute({
      executable: 'codex',
      args: ['exec'],
      cwd: root,
      executionAuthority: workshopAuthority,
      providerRequest: {
        host: 'codex',
        prompt: 'mutate',
        allowGuestMutation: true,
        workspaceHash: 'a'.repeat(64),
        approvalAuthority: verifyProviderApprovalAuthority('codex', { decisions: [] }, () => true),
      },
    });
    expect(executed).toBe(true);
  });
});
