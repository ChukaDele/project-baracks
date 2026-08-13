import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proof that discovery remains PROCESS-FREE. Every
 * process-creating entry point of node:child_process is mocked to throw the
 * moment it is called, so if provider discovery or dry-run routing tried to
 * spawn or execFile a binary — including an environment/PATH-selected override
 * — these tests would fail loudly. (End-to-end, compiled-CLI, sentinel-based
 * coverage of doctor and route inspection lives in cli.test.ts.)
 */

// `calls` is hoisted alongside vi.mock so the (hoisted) factory can reference it.
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('node:child_process', () => {
  const track =
    (name: string) =>
    (...args: unknown[]) => {
      void args;
      calls.push(name);
      throw new Error(`no subprocess is permitted during discovery, but ${name} was called`);
    };
  return {
    spawn: track('spawn'),
    spawnSync: track('spawnSync'),
    exec: track('exec'),
    execSync: track('execSync'),
    execFile: track('execFile'),
    execFileSync: track('execFileSync'),
    fork: track('fork'),
  };
});

// Imported AFTER the mock (vi.mock is hoisted): these are the discovery paths.
import { ClaudeCodeProvider } from '../src/providers/claude-code.js';
import { CodexProvider } from '../src/providers/codex.js';
import { cursorProvider } from '../src/providers/cursor.js';
import { antigravityArgs, antigravityProvider } from '../src/providers/antigravity.js';
import { route } from '../src/routing/router.js';
import { ExecutionGateway } from '../src/security/gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';
import { workerCommand } from '../src/supervisor/worker.js';

function probeGateway() {
  return ExecutionGateway.probeOnly({
    commandPolicy: { allowedExecutables: ['claude', 'codex', 'cursor-agent', 'agy'] },
    trustedExecutables: new TrustedExecutableRegistry(),
    recordDecision: () => undefined,
  });
}

function providers() {
  const gateway = probeGateway();
  return [
    new ClaudeCodeProvider({ gateway }),
    new CodexProvider({ gateway }),
    cursorProvider({ gateway }),
    antigravityProvider({ gateway }),
  ];
}

beforeEach(() => {
  calls.length = 0;
});

describe('discovery is process-free', () => {
  it('direct provider discovery creates no process', async () => {
    for (const provider of providers()) {
      await provider.discover();
      await provider.probe();
    }
    expect(calls).toEqual([]);
  });

  it('represents provider/model availability as unverified, never available', async () => {
    for (const provider of providers()) {
      const info = await provider.discover();
      expect(info.installed).toBe(false);
      expect(info.authenticated).toBe(false);
      expect(info.executableUnverified).toBe(true);
      expect(info.version).toBeUndefined();
      expect(info.models.length).toBeGreaterThan(0);
      expect(info.models.every((m) => m.availability !== 'available')).toBe(true);
      expect(info.models.every((m) => m.billingMode === 'unknown')).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('ignores a hostile environment-selected executable and never invokes it', async () => {
    const previous = process.env.MAJOR_CLAUDE_BIN;
    process.env.MAJOR_CLAUDE_BIN = '/definitely/hostile/claude';
    try {
      const [claude] = providers();
      const info = await claude!.discover();
      // The override is not consulted at all: it never appears as the resolved
      // executable, and — proven by the spies — is never executed.
      expect(info.executable).not.toBe('/definitely/hostile/claude');
      expect(calls).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.MAJOR_CLAUDE_BIN;
      else process.env.MAJOR_CLAUDE_BIN = previous;
    }
  });

  it('dry-run routing over discovered providers creates no process', async () => {
    const infos = await Promise.all(providers().map((p) => p.discover()));
    const decision = route({ purpose: 'implementation', complexity: 'bounded' }, infos);
    // Nothing is verified/available/billable, so routing checkpoints rather
    // than routing to a model — and it does so without any subprocess.
    expect(decision.kind).toBe('checkpoint');
    expect(calls).toEqual([]);
  });

  it('never grants Antigravity unattended host authority in provider or worker commands', () => {
    const request = { prompt: 'review this change', cwd: '/tmp' };
    expect(antigravityArgs(request)).toEqual([
      '--output-format',
      'stream-json',
      '--sandbox',
      '--disable-slash-commands',
      '--mode',
      'plan',
      '--new-project',
      '-p',
      'review this change',
    ]);
    expect(workerCommand('antigravity', request.prompt).args).toEqual([
      '--output-format',
      'json',
      '--sandbox',
      '--disable-slash-commands',
      '--mode',
      'plan',
      '--new-project',
      '-p',
      'review this change',
    ]);
    expect([...antigravityArgs(request), ...workerCommand('antigravity', '').args]).not.toContain(
      '--dangerously-skip-permissions',
    );
  });

  it('pins non-bypass modes for Claude and Codex and native ACP for Cursor workers', () => {
    process.env.MAJOR_CLAUDE_PERMISSION_MODE = 'bypassPermissions';
    const claude = workerCommand('claude', 'work').args;
    const codex = workerCommand('codex', 'work').args;
    const cursor = workerCommand('cursor', 'work').args;
    expect(claude).toContain('auto');
    expect(claude).not.toContain('bypassPermissions');
    expect(codex).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--ephemeral']));
    expect(cursor).toEqual(['acp']);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
