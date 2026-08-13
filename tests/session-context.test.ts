import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSessionContextCli } from '../src/context/session-context.js';
import { captureLearning, promoteLearning } from '../src/learning/candidates.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { startGoal } from '../src/supervisor/state.js';

let root = '';
const prior: Record<string, string | undefined> = {};
const envKeys = [
  'MAJOR_STATE_PATH',
  'MAJOR_POLICY_PATH',
  'MAJOR_LEARNING_ROOT',
  'MAJOR_RESOURCE_PATH',
  'MAJOR_STOP_PATH',
  'MAJOR_SKILLS_REGISTRY',
] as const;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-fresh-session-'));
  for (const key of envKeys) prior[key] = process.env[key];
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_LEARNING_ROOT = join(root, 'learning');
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  process.env.MAJOR_STOP_PATH = join(root, 'STOP');
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
});
