import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSupervisorCli } from '../src/supervisor/cli.js';
import { decideCursorPermission } from '../src/execution/cursor-acp-runtime.js';
import { verifyProviderDecision } from '../src/security/major-gateway.js';
import { writeSupervisorState, type SupervisorGoal } from '../src/supervisor/state.js';
import { openDb } from '../src/db/client.js';
import {
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';
import { model } from './helpers.js';

let root: string;
let priorStatePath: string | undefined;
let priorDbPath: string | undefined;
let priorPolicyPath: string | undefined;
let priorResourcePath: string | undefined;

function goal(): SupervisorGoal {
  return {
    id: 'goal-1',
    project: 'major',
    repoPath: root,
    goal: 'Validate Major',
    autonomous: false,
    status: 'active',
    preferredCoordinator: 'codex',
    cycle: 1,
    consecutiveFailures: 0,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    lastCoordinator: 'codex',
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-supervisor-cli-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  priorDbPath = process.env.MAJOR_DB_PATH;
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'supervisor-state.json');
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(
    join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/ChukaDele/project-baracks.git\n',
  );
  writeSupervisorState({ version: 1, goals: [goal()], sessions: [] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  if (priorResourcePath === undefined) delete process.env.MAJOR_RESOURCE_PATH;
  else process.env.MAJOR_RESOURCE_PATH = priorResourcePath;
  rmSync(root, { recursive: true, force: true });
});

describe('supervisor CLI authority', () => {
  it('refuses direct done and running reports', async () => {
    await expect(
      runSupervisorCli([
        'goal',
        'report',
        '--id',
        'goal-1',
        '--status',
        'done',
        '--summary',
        'self certified',
      ]),
    ).rejects.toThrow(/invalid goal status/);
    await expect(
      runSupervisorCli([
        'goal',
        'report',
        '--id',
        'goal-1',
        '--status',
        'running',
        '--summary',
        'forged running state',
      ]),
    ).rejects.toThrow(/invalid goal status/);
  });

  it('does not claim the read-only route command', async () => {
    await expect(runSupervisorCli(['route', '--task', 'task-1'])).resolves.toBe(false);
  });

  it('creates and explicitly resolves scoped provider DecisionRequests', async () => {
    const output: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => output.push(String(value)));
    await expect(
      runSupervisorCli([
        'decision',
        'request',
        '--project',
        'github.com/chukadele/project-baracks',
        '--provider',
        'cursor',
        '--category',
        'command_execution',
        '--question',
        'Allow the controlled field validation command?',
        '--action-json',
        JSON.stringify({
          kind: 'execute',
          name: 'Shell',
          title: 'Run tests',
          rawInput: { command: 'pnpm test', cwd: '/workspace' },
        }),
      ]),
    ).resolves.toBe(true);
    const requested = JSON.parse(output.at(-1)!) as { id: string; actionDigest: string };
    const id = requested.id;
    await expect(
      runSupervisorCli([
        'decision',
        'resolve',
        '--id',
        id,
        '--status',
        'approved',
        '--resolution',
        'owner approved field validation',
      ]),
    ).resolves.toBe(true);
    expect(JSON.parse(output.at(-1)!) as { status: string }).toMatchObject({ status: 'approved' });
    expect(
      verifyProviderDecision({
        cwd: root,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: id,
        actionDigest: requested.actionDigest,
        consumerId: 'cli-cursor-e2e',
      }),
    ).toBe(true);
    const decisions = [
      {
        category: 'command_execution' as const,
        decisionId: id,
        actionDigest: requested.actionDigest,
      },
    ];
    expect(
      decideCursorPermission(
        {
          kind: 'execute',
          name: 'Shell',
          title: 'Run tests',
          rawInput: { command: 'pnpm test', cwd: '/workspace' },
        },
        { decisions },
        [...decisions],
      ).outcome,
    ).toBe('automatic');
  });
});

describe('major status: host/provider breakdown, separate from goal detail', () => {
  it('shows hosts, execution-provider health, fallback capacity and a fresh live-worker claim', async () => {
    const scratchHome = mkdtempSync(join(tmpdir(), 'major-status-home-'));
    const priorHome = process.env.HOME;
    const priorCodexHome = process.env.CODEX_HOME;
    process.env.HOME = scratchHome;
    process.env.CODEX_HOME = join(scratchHome, '.codex');
    try {
      const opened = openDb(process.env.MAJOR_DB_PATH);
      persistProviderDiscovery(
        opened.db,
        {
          name: 'codex',
          installed: true,
          authenticated: true,
          models: [model({ modelRef: 'gpt-codex', routingClass: 'codex' })],
        },
        { source: 'cli' },
      );
      recordBillingObservation(opened.db, {
        providerName: 'codex',
        modelRef: 'gpt-codex',
        billingMode: 'subscription_included',
        source: 'human',
      });
      opened.sqlite.close();

      writeSupervisorState({
        version: 1,
        goals: [
          {
            ...goal(),
            liveWorker: {
              host: 'codex',
              sessionId: 'thread-live',
              claimedAt: new Date().toISOString(),
              heartbeatAt: new Date().toISOString(),
            },
          },
        ],
        sessions: [],
      });

      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
      expect(await runSupervisorCli(['status'])).toBe(true);
      const output = lines.join('\n');

      expect(output).toContain('MAJOR: ACTIVE');
      expect(output).toContain('Hosts:');
      expect(output).toMatch(/claude\(not integrated\)/);
      expect(output).toContain('Execution providers:');
      expect(output).toContain('codex=READY');
      expect(output).toContain('Fallback capacity:    1 healthy provider');
      expect(output).toContain('live worker: codex@thread-live');
      expect(output).toContain('heartbeat 0m ago');
      expect(output).not.toContain('stale, reclaimable');
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = priorCodexHome;
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });

  it('reports a stale live-worker claim as reclaimable and the kill switch as stopped', async () => {
    const scratchHome = mkdtempSync(join(tmpdir(), 'major-status-home-'));
    const priorHome = process.env.HOME;
    process.env.HOME = scratchHome;
    const stopPath = join(root, 'STOP');
    writeFileSync(stopPath, 'stopped\n');
    const priorStopPath = process.env.MAJOR_STOP_PATH;
    process.env.MAJOR_STOP_PATH = stopPath;
    try {
      writeSupervisorState({
        version: 1,
        goals: [
          {
            ...goal(),
            liveWorker: {
              host: 'codex',
              sessionId: 'thread-stale',
              claimedAt: '2020-01-01T00:00:00.000Z',
              heartbeatAt: '2020-01-01T00:00:00.000Z',
            },
          },
        ],
        sessions: [],
      });

      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
      expect(await runSupervisorCli(['status'])).toBe(true);
      const output = lines.join('\n');

      expect(output).toContain('MAJOR: STOPPED (kill switch active)');
      expect(output).toContain('live worker: codex@thread-stale (stale, reclaimable)');
      expect(output).toContain('Fallback capacity:    0 healthy providers');
      expect(output).toContain('Execution providers:  none discovered');
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      if (priorStopPath === undefined) delete process.env.MAJOR_STOP_PATH;
      else process.env.MAJOR_STOP_PATH = priorStopPath;
      rmSync(scratchHome, { recursive: true, force: true });
    }
  });
});
