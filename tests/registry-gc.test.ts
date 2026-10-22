import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client.js';
import { projects } from '../src/db/schema.js';
import { createDecisionRequest, listDecisions } from '../src/domain/decision-service.js';
import { applyRegistryGc, planRegistryGc } from '../src/resources/registry-gc.js';
import { listProjectPolicies } from '../src/supervisor/policy.js';
import {
  readSupervisorState,
  writeSupervisorState,
  type SupervisorGoal,
} from '../src/supervisor/state.js';

const ENV = ['MAJOR_HOME', 'MAJOR_STATE_PATH', 'MAJOR_POLICY_PATH', 'MAJOR_DB_PATH'] as const;
let root = '';
const prior: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-registry-gc-'));
  for (const key of ENV) prior[key] = process.env[key];
  process.env.MAJOR_HOME = join(root, '.major');
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
});

afterEach(() => {
  for (const key of ENV) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(root, { recursive: true, force: true });
});

function goal(id: string, project: string, repoPath: string, status: SupervisorGoal['status']) {
  return {
    id,
    project,
    repoPath,
    goal: id,
    autonomous: false,
    status,
    preferredCoordinator: 'claude',
    cycle: 0,
    consecutiveFailures: 0,
    createdAt: 'x',
    updatedAt: 'x',
  } satisfies SupervisorGoal;
}

function addRow(db: Db, name: string, repoPath: string) {
  const id = `proj_${name}`;
  db.insert(projects).values({ id, name, repoPath, configJson: '{}' }).run();
  return id;
}

describe('registry GC and decision expiry', () => {
  it('archives only entries whose path and project identity are gone', () => {
    const live = join(root, 'live');
    mkdirSync(live);
    const gone = join(root, 'gone');
    writeSupervisorState({
      version: 1,
      sessions: [],
      goals: [
        goal('probe-active', 'probe', gone, 'active'),
        goal('main-moved', 'main', gone, 'active'),
        goal('main-paused', 'main', gone, 'paused'),
        goal('main-live', 'main', live, 'active'),
      ],
    });
    writeFileSync(
      process.env.MAJOR_POLICY_PATH!,
      JSON.stringify({
        version: 1,
        projects: [
          { project: 'probe', repoPath: gone, projectClass: 'workshop', trust: 'build' },
          { project: 'main', repoPath: gone, projectClass: 'workshop', trust: 'build' },
        ],
      }),
    );
    const { db } = openDb();
    addRow(db, 'probe', gone);
    const referenced = addRow(db, 'ref', gone);
    addRow(db, 'main', live);
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    createDecisionRequest(db, {
      category: 'push',
      question: 'q',
      projectId: referenced,
      expiresAt: past,
    });
    const open = createDecisionRequest(db, { category: 'push', question: 'q', expiresAt: future });

    const plan = planRegistryGc(db);
    expect(plan.goals.map((g) => g.id).sort()).toEqual(['main-paused', 'probe-active']);
    expect(plan.policies.map((p) => p.project)).toEqual(['probe']);
    expect(plan.projects.map((p) => p.name).sort()).toEqual(['probe', 'ref']);
    expect(plan.expiredDecisions).toBe(1);
    // Planning (dry run) mutates nothing.
    expect(readSupervisorState().goals).toHaveLength(4);
    expect(existsSync(join(root, '.major', 'archive'))).toBe(false);

    const result = applyRegistryGc(db, plan);
    expect(result.expiredDecisions).toBe(1);
    expect(result.retainedProjects).toEqual(['ref']);
    expect(
      readSupervisorState()
        .goals.map((g) => g.id)
        .sort(),
    ).toEqual(['main-live', 'main-moved']);
    expect(listProjectPolicies().map((p) => p.project)).toEqual(['main']);
    expect(
      db
        .select()
        .from(projects)
        .all()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['main', 'ref']);
    const archive = JSON.parse(readFileSync(result.archivePath!, 'utf8'));
    expect(archive.goals).toHaveLength(2);
    expect(archive.policies).toHaveLength(1);

    expect(listDecisions(db).map((d) => d.id)).toEqual([open.id]);
    expect(
      listDecisions(db, { all: true })
        .map((d) => d.status)
        .sort(),
    ).toEqual(['expired', 'open']);
  });
});
