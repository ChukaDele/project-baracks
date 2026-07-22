import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

describe('trusted canonical executable binding', () => {
  it('refuses an allowlisted name with no trusted installation registered', () => {
    const { gateway, root, decisions } = makeGateway({
      trustedExecutables: new TrustedExecutableRegistry(),
    });
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      /no trusted installation/,
    );
    expect(decisions[0]!.allowed).toBe(false);
  });

  it('refuses a shadow binary with an allowed basename at an untrusted path', () => {
    const { gateway, root, decisions } = makeGateway();
    const shadowDir = tempRoot();
    const shadow = join(shadowDir, 'node');
    writeFileSync(shadow, '#!/bin/sh\necho pwned\n');
    chmodSync(shadow, 0o755);
    expect(() => gateway.execute({ executable: shadow, args: ['-e', '1'], cwd: root })).toThrow(
      /does not match the trusted canonical installation/,
    );
    expect(decisions[0]!.allowed).toBe(false);
  });

  it('spawns the trusted installation for a bare name, ignoring lookalike paths', async () => {
    const { gateway, root } = makeGateway();
    const handle = gateway.execute({
      executable: 'node',
      args: ['-e', 'console.log(JSON.stringify({type:"which",p:process.execPath}))'],
      cwd: root,
    });
    const events = [];
    for await (const e of handle.events) events.push(e);
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('succeeded');
    expect(realpathSync((events[0]!.data as { p: string }).p)).toBe(realpathSync(NODE));
  });

  it('accepts a path-qualified request that resolves to the trusted identity', async () => {
    const { gateway, root } = makeGateway();
    const linkDir = tempRoot();
    const link = join(linkDir, 'node');
    symlinkSync(NODE, link);
    const outcome = await gateway.execute({ executable: link, args: ['-e', '1'], cwd: root })
      .outcome;
    expect(outcome.status).toBe('succeeded');
  });

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

  it('a poisoned child PATH cannot shadow the trusted binary', async () => {
    const evilDir = tempRoot();
    const evil = join(evilDir, 'node');
    writeFileSync(evil, '#!/bin/sh\necho SHADOWED\n');
    chmodSync(evil, 0o755);
    const { gateway, root } = makeGateway({
      baseEnv: { PATH: `${evilDir}:${process.env.PATH ?? ''}` },
    });
    const handle = gateway.execute({
      executable: 'node',
      args: ['-e', 'console.log(JSON.stringify({type:"ok",p:process.execPath}))'],
      cwd: root,
    });
    const events = [];
    for await (const e of handle.events) events.push(e);
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('succeeded');
    // the pre-trusted canonical installation ran, not the PATH shadow
    expect(realpathSync((events[0]!.data as { p: string }).p)).toBe(realpathSync(NODE));
  });
});

describe('containment', () => {
  it('runs allowed commands inside a configured root', async () => {
    const { gateway, decisions, root } = makeGateway();
    const handle = gateway.execute({
      executable: NODE,
      args: ['-e', 'console.log(JSON.stringify({type:"ok"}))'],
      cwd: root,
    });
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('succeeded');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'execute', allowed: true, reason: 'allowed' });
  });

  it('refuses a cwd outside every root and records the refusal', () => {
    const { gateway, decisions } = makeGateway();
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: '/etc' })).toThrow(
      GatewayViolationError,
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.allowed).toBe(false);
  });

  it('refuses path traversal out of a root', () => {
    const { gateway, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: join(root, '..', '..') }),
    ).toThrow(GatewayViolationError);
  });

  it('refuses a symlinked cwd that escapes the root', () => {
    const { gateway, root } = makeGateway();
    const outside = tempRoot();
    const link = join(root, 'sneaky');
    symlinkSync(outside, link);
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: link })).toThrow(
      GatewayViolationError,
    );
  });

  it('accepts a symlink that stays inside the root', async () => {
    const { gateway, root } = makeGateway();
    const realDir = join(root, 'real');
    mkdirSync(realDir);
    const link = join(root, 'alias');
    symlinkSync(realDir, link);
    const outcome = await gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: link })
      .outcome;
    expect(outcome.status).toBe('succeeded');
  });

  it('refuses a nonexistent cwd', () => {
    const { gateway, root } = makeGateway();
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: join(root, 'missing') }),
    ).toThrow(GatewayViolationError);
  });
});

describe('argv command policy at spawn time', () => {
  it('refuses executables missing from the allowlist', () => {
    const { gateway, root, decisions } = makeGateway();
    expect(() => gateway.execute({ executable: 'curl', args: ['http://x'], cwd: root })).toThrow(
      GatewayViolationError,
    );
    expect(decisions[0]!.reason).toContain('allowlist');
  });

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

describe('environment sanitisation', () => {
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

  it('the child process never sees stripped variables', async () => {
    const { gateway, root } = makeGateway({
      baseEnv: {
        PATH: process.env.PATH ?? '',
        ANTHROPIC_API_KEY: 'sk-ant-secret',
      },
    });
    const handle = gateway.execute({
      executable: NODE,
      args: [
        '-e',
        'console.log(JSON.stringify({type:"env",has:Boolean(process.env.ANTHROPIC_API_KEY)}))',
      ],
      cwd: root,
    });
    const events = [];
    for await (const e of handle.events) events.push(e);
    await handle.outcome;
    expect((events[0]!.data as { has: boolean }).has).toBe(false);
  });

  it('refuses sensitive env passthrough without a verified DecisionRequest', () => {
    const { gateway, root, decisions } = makeGateway({
      authorizedEnv: { names: ['ANTHROPIC_API_KEY'], decisionId: 'dreq_x' },
      // no verifyDecision provided -> cannot be verified -> refuse
    });
    expect(() => gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root })).toThrow(
      /not approved/,
    );
    expect(decisions[0]!.allowed).toBe(false);
  });

  it('passes sensitive env through only when the DecisionRequest verifies', async () => {
    const { gateway, root, decisions } = makeGateway({
      baseEnv: { PATH: process.env.PATH ?? '', ANTHROPIC_API_KEY: 'sk-ant-approved' },
      authorizedEnv: { names: ['ANTHROPIC_API_KEY'], decisionId: 'dreq_ok' },
      verifyDecision: (id) => id === 'dreq_ok',
    });
    const handle = gateway.execute({
      executable: NODE,
      args: [
        '-e',
        'console.log(JSON.stringify({type:"env",has:Boolean(process.env.ANTHROPIC_API_KEY)}))',
      ],
      cwd: root,
    });
    const events = [];
    for await (const e of handle.events) events.push(e);
    await handle.outcome;
    expect((events[0]!.data as { has: boolean }).has).toBe(true);
    expect(decisions[0]).toMatchObject({
      allowed: true,
      authorizedEnv: ['ANTHROPIC_API_KEY'],
      envDecisionId: 'dreq_ok',
    });
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
    expect(JSON.stringify(decisions)).not.toContain('ghp_abcdef');
  });
});

describe('persisted audit trail', () => {
  it('records decisions to the append-only execution_policy_decisions table', async () => {
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
    await gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: root }).outcome;
    expect(() => gateway.execute({ executable: 'curl', args: ['x'], cwd: root })).toThrow();
    const rows = db.select().from(executionPolicyDecisions).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.allowed)).toEqual([true, false]);
    expect(() => db.delete(executionPolicyDecisions).run()).toThrow(/append-only/);
  });
});

describe('probes', () => {
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

  it('a probe-only gateway refuses all execution', () => {
    const decisions: ExecutionPolicyDecision[] = [];
    const gateway = ExecutionGateway.probeOnly({
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: new TrustedExecutableRegistry(),
      recordDecision: (d) => decisions.push(d),
    });
    expect(() =>
      gateway.execute({ executable: NODE, args: ['-e', '1'], cwd: process.cwd() }),
    ).toThrow(GatewayViolationError);
    expect(decisions[0]!.allowed).toBe(false);
    expect(gateway.probeSync('which', ['node'])).toBeDefined();
  });
});
