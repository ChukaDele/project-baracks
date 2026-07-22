import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests against the real CLI process: exit codes, versioned JSON
 * output, existence checks, and refusal semantics.
 */

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

let dbPath: string;
let repoDir: string;
let configPath: string;

function major(...args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, MAJOR_DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeAll(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'major-cli-'));
  dbPath = join(scratch, 'major.db');
  repoDir = join(scratch, 'demo-repo');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  configPath = join(scratch, 'demo.project.json');
  writeFileSync(configPath, JSON.stringify({ name: 'demo', repoPath: repoDir }));
});

describe('major CLI', () => {
  it('project add validates config existence and git-repository shape', () => {
    expect(major('project', 'add', '/nope/missing.json').status).toBe(2);

    const scratch = mkdtempSync(join(tmpdir(), 'major-nonrepo-'));
    const badConfig = join(scratch, 'bad.json');
    writeFileSync(badConfig, JSON.stringify({ name: 'bad', repoPath: scratch }));
    const result = major('project', 'add', badConfig);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a git repository/);
  });

  it('registers a valid project and lists it as versioned JSON', () => {
    expect(major('project', 'add', configPath).status).toBe(0);
    const list = major('project', 'list', '--json');
    expect(list.status).toBe(0);
    const parsed = JSON.parse(list.stdout) as {
      schemaVersion: number;
      kind: string;
      data: { name: string }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('project-list');
    expect(parsed.data[0]?.name).toBe('demo');
  });

  it('rejects invalid option values with a usage exit code', () => {
    const result = major(
      'task',
      'add',
      '--project',
      'demo',
      '--title',
      'x',
      '--complexity',
      'epic',
    );
    expect(result.status).toBe(2);
  });

  it('exits 3 for unknown entities', () => {
    expect(major('task', 'show', 'task_missing').status).toBe(3);
    expect(major('task', 'list', '--project', 'ghost').status).toBe(3);
  });

  it('creates and lists tasks with stable JSON envelopes', () => {
    expect(major('task', 'add', '--project', 'demo', '--title', 'first task').status).toBe(0);
    const list = major('task', 'list', '--project', 'demo', '--json');
    const parsed = JSON.parse(list.stdout) as { data: { title: string; status: string }[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toMatchObject({ title: 'first task', status: 'draft' });
  });

  it('refuses live execution with the policy-refusal exit code', () => {
    const list = major('task', 'list', '--project', 'demo', '--json');
    const taskId = (JSON.parse(list.stdout) as { data: { id: string }[] }).data[0]!.id;
    const result = major('run', '--task', taskId);
    expect(result.status).toBe(4);
    expect(result.stderr).toMatch(/live execution is not enabled/);
  });

  it('folds duplicate suggestions and suppresses rejected scopes with exit 4', () => {
    const first = major('task', 'suggest', '--project', 'demo', '--title', 'Add rate limiting');
    expect(first.status).toBe(0);
    const suggestionId = first.stdout.match(/tsug_\w+/)?.[0];
    expect(suggestionId).toBeTruthy();

    const dup = major('task', 'suggest', '--project', 'demo', '--title', 'add RATE limiting');
    expect(dup.status).toBe(0);
    expect(dup.stdout).toMatch(/duplicate of pending suggestion/);

    expect(major('task', 'reject', suggestionId!, '--note', 'no').status).toBe(0);
    const suppressed = major(
      'task',
      'suggest',
      '--project',
      'demo',
      '--title',
      'Add rate limiting',
    );
    expect(suppressed.status).toBe(4);
    expect(suppressed.stderr).toMatch(/suppressed/);
  });

  it('doctor emits versioned JSON and a strict exit code (0 safe, 5 unsafe)', () => {
    const result = major('doctor', '--json');
    expect([0, 5]).toContain(result.status);
    const parsed = JSON.parse(result.stdout) as { schemaVersion: number; kind: string };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('doctor-report');
  }, 90_000);
});
