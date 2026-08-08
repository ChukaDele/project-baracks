import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coordinatorPrompt } from '../src/supervisor/runtime.js';
import type { SupervisorGoal } from '../src/supervisor/state.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function goal(repoPath: string): SupervisorGoal {
  return {
    id: 'goal-1',
    project: 'jss-tool',
    repoPath,
    goal: 'Ship the smallest credible end-to-end JSS MVP',
    autonomous: true,
    status: 'active',
    preferredCoordinator: 'claude',
    cycle: 0,
    consecutiveFailures: 0,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

describe('Major coordinator contract', () => {
  it('keeps the product goal, MVP loop, delegation and durable reporting in every coordinator cycle', () => {
    const repo = mkdtempSync(join(tmpdir(), 'major-runtime-'));
    roots.push(repo);
    mkdirSync(join(repo, '.git'));
    writeFileSync(
      join(repo, 'GOAL_STATE.md'),
      '# Goal state\nCurrent P0: source → assess → tailor.\n',
    );
    writeFileSync(join(repo, 'AGENTS.md'), '# Project contract\nContinue through safe blockers.\n');

    const prompt = coordinatorPrompt(goal(repo));
    expect(prompt).toContain('Ship the smallest credible end-to-end JSS MVP');
    expect(prompt).toContain('Speed and MVP are the default');
    expect(prompt).toContain('4–6 useful workers');
    expect(prompt).toContain('max 8');
    expect(prompt).toContain('major delegate --provider codex');
    expect(prompt).toContain('major delegate --provider cursor');
    expect(prompt).toContain('major delegate --provider antigravity');
    expect(prompt).toContain('major goal report --id "goal-1" --status active');
    expect(prompt).toContain('Do not mark done unless the end-to-end goal is demonstrably true');
    expect(prompt).toContain('source → assess → tailor');
  });
});
