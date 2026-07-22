import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { checkArgv } from '../src/security/commands.js';
import { processTreeContainment } from '../src/security/containment.js';
import { BILLING_ENV_NAMES, sanitizeEnv } from '../src/security/env.js';
import {
  ExecutionGateway,
  GatewayViolationError,
  type ExecutionPolicyDecision,
} from '../src/security/gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';

const NODE = process.execPath;

function tempRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'major-gw-')));
}

/** A registry that already trusts the real node binary under the name 'node'. */
function trustingNode(): TrustedExecutableRegistry {
  const registry = new TrustedExecutableRegistry();
  registry.pin(NODE);
  return registry;
}

/**
 * The most permissive gateway this build can construct: allowed roots, a
 * trusted installation, containment configured. Even this must refuse
 * execute() — live agent execution is an unavailable capability.
 */
function makeGateway(overrides: Partial<ConstructorParameters<typeof ExecutionGateway>[0]> = {}) {
  const decisions: ExecutionPolicyDecision[] = [];
  const root = overrides.allowedRoots?.[0] ?? tempRoot();
  const gateway = new ExecutionGateway({
    allowedRoots: [root],
    commandPolicy: { allowedExecutables: ['node', 'git', 'which'] },
    trustedExecutables: trustingNode(),
    baseEnv: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    recordDecision: (d) => decisions.push(d),
    containment: processTreeContainment(),
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

describe('execute() is disabled in this build (live-agent-execution unavailable)', () => {
  it('refuses even a maximally configured gateway, before any spawn', () => {
    const { gateway, decisions, root } = makeGateway();
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'execute', allowed: false });
    expect(decisions[0]!.reason).toMatch(/live-agent-execution/);
  });

  it('refuses a probe-only gateway the same way and records the refusal', () => {
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
    expect(gateway.probeSync('which', ['node'])).toBeDefined();
  });

  it('no gateway option can re-enable execution (there is no such option)', () => {
    // Deliberately-hostile configuration: even claiming enforced containment
    // and full filesystem isolation does not open the capability gate.
    const { gateway, root } = makeGateway({
      containment: {
        enforced: true,
        filesystemIsolation: true,
        mechanism: 'claimed-sandbox',
        detail: 'a configuration claim, not enforcement',
      },
    });
    expect(() => gateway.execute({ executable: 'node', args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
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

  it('records refusals to the append-only execution_policy_decisions table', async () => {
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
      containment: processTreeContainment(),
    });
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      CapabilityUnavailableError,
    );
    gateway.probeSync('which', ['node']);
    const rows = db.select().from(executionPolicyDecisions).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.allowed)).toEqual([false, true]);
    expect(() => db.delete(executionPolicyDecisions).run()).toThrow(/append-only/);
  });
});

describe('probes (read-only discovery, still available)', () => {
  it('allows which/version probes and records them', () => {
    const { gateway, decisions } = makeGateway();
    const resolved = gateway.probeSync('which', ['node']);
    expect(resolved).toContain('node');
    expect(decisions[0]).toMatchObject({ kind: 'probe', allowed: true });
  });

  it('refuses probes with arbitrary arguments', () => {
    const { gateway } = makeGateway();
    expect(() => gateway.probeSync('git', ['clone', 'http://evil'])).toThrow(GatewayViolationError);
    expect(() => gateway.probeSync('which', ['a; rm -rf /'])).toThrow(GatewayViolationError);
  });
});
