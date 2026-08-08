import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureProjectPolicy,
  recordShadowGrade,
} from '../src/supervisor/policy.js';
import { coordinatorPrompt } from '../src/supervisor/runtime.js';
import type { SupervisorGoal } from '../src/supervisor/state.js';

const roots: string[] = [];
let priorPolicyPath: string | undefined;

beforeEach(() => {
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
});

afterEach(() => {
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function goal(repoPath: string): SupervisorGoal {
  return {
    id: 'goal-1',
    project: 'jss-tool',
    repoPath,
    goal: 'Ship the smallest credible end-to-end JSS MVP',
    autonomous: false,
    status: 'active',
    preferredCoordinator: 'claude',
    cycle: 0,
    consecutiveFailures: 0,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

describe('Major coordinator contract', () => {
  it('keeps the product goal while respecting earned assist trust and thin-kernel skill-first execution', () => {
    const repo = mkdtempSync(join(tmpdir(), 'major-runtime-'));
    roots.push(repo);
    process.env.MAJOR_POLICY_PATH = join(repo, 'policies.json');
    mkdirSync(join(repo, '.git'));
    writeFileSync(
      join(repo, 'GOAL_STATE.md'),
      '# Goal state\nCurrent P0: source → assess → tailor.\n',
    );
    writeFileSync(join(repo, 'AGENTS.md'), '# Project contract\nContinue through safe blockers.\n');

    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: repo,
      projectClass: 'workshop',
      trust: 'observe',
    });
    for (let i = 0; i < 3; i++) {
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: repo,
        planner: 'codex',
        provider: 'claude',
        result: 'pass',
        evidence: `shadow ${i + 1} matched actual task path`,
        goalId: 'goal-1',
      });
    }
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: repo,
      projectClass: 'workshop',
      trust: 'assist',
    });

    const prompt = coordinatorPrompt(goal(repo));
    expect(prompt).toContain('Ship the smallest credible end-to-end JSS MVP');
    expect(prompt).toContain('Speed and MVP are the default');
    expect(prompt).toContain('class: workshop');
    expect(prompt).toContain('trust: assist');
    expect(prompt).toContain('maximum concurrent workers: 3');
    expect(prompt).toContain('maximum coordinator run: 30 minutes');
    expect(prompt).toContain('Tools-as-Code');
    expect(prompt).toContain('Skillify');
    expect(prompt).toContain('BUILT = implementation exists');
    expect(prompt).toContain('major goal report --id "goal-1" --status active');
    expect(prompt).toContain('Do not mark done unless the end-to-end goal is demonstrably true');
    expect(prompt).toContain('source → assess → tailor');
  });
});
