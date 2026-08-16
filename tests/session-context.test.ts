import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSessionContextCli } from '../src/context/session-context.js';
import { captureLearning, promoteLearning } from '../src/learning/candidates.js';
import { openDb } from '../src/db/client.js';
import {
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { readSupervisorState, startGoal } from '../src/supervisor/state.js';
import {
  assertSupervisedWorkshopAuthority,
  resolveSupervisedWorkshopAuthority,
} from '../src/security/supervised-workshop.js';
import { model } from './helpers.js';

let root = '';
const prior: Record<string, string | undefined> = {};
const envKeys = [
  'MAJOR_STATE_PATH',
  'MAJOR_POLICY_PATH',
  'MAJOR_LEARNING_ROOT',
  'MAJOR_RESOURCE_PATH',
  'MAJOR_STOP_PATH',
  'MAJOR_SKILLS_REGISTRY',
  'MAJOR_HOME',
  'MAJOR_DB_PATH',
] as const;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-fresh-session-'));
  for (const key of envKeys) prior[key] = process.env[key];
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_LEARNING_ROOT = join(root, 'learning');
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  process.env.MAJOR_STOP_PATH = join(root, 'STOP');
  process.env.MAJOR_HOME = join(root, 'major-home');
  // The banner's current-worker-capacity read opens a real DB connection;
  // isolate it like every other piece of Major state, or these tests would
  // read whatever happens to be at the developer's real ~/.major/major.db.
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of envKeys) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(root, { recursive: true, force: true });
});

function repo(name: string): string {
  const path = join(root, name);
  mkdirSync(join(path, '.git'), { recursive: true });
  writeFileSync(
    join(path, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/example/${name}.git\n`,
  );
  return path;
}

describe('fresh session context', () => {
  it('authorizes one expiring project-bound Workshop session and revokes it', async () => {
    const current = repo('workshop-project');
    const sibling = repo('other-project');
    const separateClone = repo('workshop-clone');
    writeFileSync(
      join(separateClone, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/example/workshop-project.git\n',
    );
    configureProjectPolicy({
      project: 'github.com/example/workshop-project',
      repoPath: current,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    expect(
      await runSessionContextCli([
        'session',
        'authorize',
        '--mode',
        'supervised-workshop',
        '--owner-approved',
        '--host',
        'codex',
        '--session-id',
        'thread-123',
        '--cwd',
        current,
        '--expires-minutes',
        '60',
      ]),
    ).toBe(true);
    const authority = resolveSupervisedWorkshopAuthority(current);
    expect(authority).toMatchObject({
      kind: 'supervised_workshop',
      sessionId: 'thread-123',
      project: 'github.com/example/workshop-project',
    });
    expect(() => assertSupervisedWorkshopAuthority(authority, current)).not.toThrow();
    expect(() => resolveSupervisedWorkshopAuthority(sibling)).toThrow(
      /owner-approved build|no active supervised/,
    );
    expect(() => resolveSupervisedWorkshopAuthority(separateClone)).toThrow(/no active supervised/);
    const sha = 'a'.repeat(40);
    expect(
      await runSessionContextCli([
        'session',
        'verify-handoff',
        '--cwd',
        current,
        '--session-id',
        'thread-123',
        '--provider',
        'codex',
        '--release-sha',
        sha,
        '--destination-instance',
        `major-worker-${sha.slice(0, 12)}`,
      ]),
    ).toBe(true);
    expect(readFileSync(join(process.env.MAJOR_HOME!, 'workshop-audit.jsonl'), 'utf8')).toContain(
      'provider-credential-handoff-authorized',
    );

    expect(
      await runSessionContextCli([
        'session',
        'revoke',
        '--session-id',
        'thread-123',
        '--cwd',
        current,
      ]),
    ).toBe(true);
    expect(() => resolveSupervisedWorkshopAuthority(current)).toThrow(/no active supervised/);
    expect(
      readSupervisorState().sessions.find((session) => session.sessionId === 'thread-123')
        ?.workshopAuthorization?.status,
    ).toBe('revoked');
  });

  it('refuses Workshop authorization without an owner-approved build policy', async () => {
    const current = repo('observe-project');
    await expect(
      runSessionContextCli([
        'session',
        'authorize',
        '--mode',
        'supervised-workshop',
        '--owner-approved',
        '--session-id',
        'thread-123',
        '--cwd',
        current,
      ]),
    ).rejects.toThrow(/owner-approved build/);
  });

  it('recalls current-project and global learning, excludes another project, and resolves video routing', async () => {
    const current = repo('creative-site');
    const local = captureLearning({
      project: 'creative-site',
      repoPath: current,
      source: 'user-correction',
      scope: 'project',
      summary: 'Keep generated source media inside the current project.',
    });
    promoteLearning({
      id: local.id,
      project: 'creative-site',
      scope: 'project',
      evidence: 'Verified with a project-local fixture.',
    });
    captureLearning({
      project: 'private-client',
      source: 'manual',
      scope: 'project',
      summary: 'PRIVATE CLIENT EVIDENCE MUST NOT APPEAR.',
    });
    const recurring = captureLearning({
      project: 'procedure-lab',
      source: 'recurring-failure',
      key: 'verify-before-ready',
      summary: 'Private source wording.',
    });
    captureLearning({
      project: 'procedure-lab',
      source: 'recurring-failure',
      key: 'verify-before-ready',
      summary: 'Private source wording repeated.',
    });
    configureProjectPolicy({
      project: 'procedure-lab',
      repoPath: join(root, 'procedure-lab'),
      projectClass: 'knowledge',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    promoteLearning({
      id: recurring.id,
      project: 'procedure-lab',
      scope: 'global',
      summary: 'Require representative runtime evidence before a readiness claim.',
      evidence: 'Verified with synthetic cross-project regression fixtures.',
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('MAJOR CONTROL PLANE: ACTIVE');
    expect(output).toContain('Keep generated source media inside the current project.');
    expect(output).toContain('Require representative runtime evidence before a readiness claim.');
    expect(output).not.toContain('PRIVATE CLIENT EVIDENCE MUST NOT APPEAR.');
  });

  it('keeps the control-plane banner active when a malformed global record is withheld', async () => {
    const current = repo('safe-project');
    const learning = join(root, 'learning');
    mkdirSync(learning, { recursive: true });
    writeFileSync(
      join(learning, 'global.json'),
      JSON.stringify({
        version: 2,
        candidates: [
          {
            id: 'unsafe',
            source: 'manual',
            summary: `Use token sk-ant-api03-${'A'.repeat(24)}`,
            scope: 'global',
            occurrences: 2,
            evidence: ['raw private evidence'],
            status: 'promoted',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('MAJOR CONTROL PLANE: ACTIVE');
    expect(output).toContain('unsafe record withheld from session context');
    expect(output).toContain('RESOURCE GUARD');
    expect(output).not.toContain('sk-ant-api03');
    expect(output).not.toContain('raw private evidence');
  });

  it('keeps session attach active when the skill registry is malformed', async () => {
    const current = repo('safe-project');
    startGoal({
      project: 'safe-project',
      repoPath: current,
      goal: 'Resolve the correct implementation skill.',
      autonomous: false,
    });
    const malformed = join(root, 'malformed-skills.json');
    writeFileSync(malformed, '{not json');
    process.env.MAJOR_SKILLS_REGISTRY = malformed;

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('MAJOR CONTROL PLANE: ACTIVE');
    expect(output).toContain('Major skill registry unavailable');
  });

  it('reports foreground authority as ready (not active) for an eligible project with no grant yet', async () => {
    const current = repo('ready-project');
    configureProjectPolicy({
      project: 'github.com/example/ready-project',
      repoPath: current,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('foreground authority: ready');
    expect(output).toContain('active goal: none');
  });

  it('reports foreground authority as not applicable for a project without owner-approved build', async () => {
    const current = repo('observe-only-project');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('foreground authority: not applicable');
  });

  it('surfaces the active goal summary and discovered worker capacity in the banner', async () => {
    const current = repo('capacity-project');
    configureProjectPolicy({
      project: 'github.com/example/capacity-project',
      repoPath: current,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    startGoal({
      project: 'github.com/example/capacity-project',
      repoPath: current,
      goal: 'Ship the ranking/shortlist workflow correctly',
      autonomous: false,
    });
    const { db, sqlite } = openDb(process.env.MAJOR_DB_PATH);
    persistProviderDiscovery(
      db,
      {
        name: 'codex',
        installed: true,
        authenticated: true,
        models: [model({ modelRef: 'gpt-codex', routingClass: 'codex' })],
      },
      { source: 'cli' },
    );
    recordBillingObservation(db, {
      providerName: 'codex',
      modelRef: 'gpt-codex',
      billingMode: 'subscription_included',
      source: 'human',
    });
    sqlite.close();
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => lines.push(String(value)));
    expect(
      await runSessionContextCli(['session', 'attach', '--host', 'codex', '--cwd', current]),
    ).toBe(true);
    const output = lines.join('\n');
    expect(output).toContain('active goal: Ship the ranking/shortlist workflow correctly [active]');
    expect(output).toContain('current worker capacity:');
    expect(output).toMatch(/current worker capacity:.*\bcodex\b/);
    expect(output).toMatch(/current worker capacity:.*claude \(not yet discovered\)/);
  });
});
