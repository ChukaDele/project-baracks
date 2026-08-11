import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSupervisorCli } from '../src/supervisor/cli.js';
import { writeSupervisorState, type SupervisorGoal } from '../src/supervisor/state.js';

let root: string;
let priorStatePath: string | undefined;

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
  process.env.MAJOR_STATE_PATH = join(root, 'supervisor-state.json');
  writeSupervisorState({ version: 1, goals: [goal()], sessions: [] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
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
});
