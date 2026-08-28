import { describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db/client.js';
import { transitionTask } from '../src/domain/task-service.js';
import { openShaperTelemetryDb, runShaperCli } from '../src/observability/shaper-cli.js';
import {
  readShaperCommandCentre,
  readShaperTelemetry,
  shaperCommandCentreCsv,
  shaperTelemetryCsv,
} from '../src/observability/shaper.js';

function seedTelemetry() {
  const opened = openDb(':memory:');
  opened.sqlite.exec(`
    INSERT INTO projects (id,name,repo_path,config_json,created_at,updated_at) VALUES
      ('p','demo','/private/client','{}','2026-08-28T09:00:00Z','2026-08-28T09:00:00Z'),
      ('p2','other','/private/other','{}','2026-08-28T09:00:00Z','2026-08-28T09:00:00Z');
    INSERT INTO tasks (id,project_id,title,description,status,complexity,version,created_at,updated_at) VALUES
      ('t','p','secret customer task','private@example.com','draft','bounded',0,'2026-08-28T09:00:00Z','2026-08-28T09:00:00Z'),
      ('t2','p','queued task','private@example.com','draft','routine',0,'2026-08-28T09:00:00Z','2026-08-28T09:00:00Z'),
      ('t3','p2','other task','other private text','draft','bounded',0,'2026-08-28T09:00:00Z','2026-08-28T09:00:00Z');
    INSERT INTO agent_providers (id,name,account_label,created_at,updated_at) VALUES
      ('ap','codex','work-account','2026-08-28T09:00:00Z','2026-08-28T09:00:00Z');
    INSERT INTO agent_models
      (id,provider_id,model_ref,routing_class,visible,authenticated,availability,billing_mode,
       prohibited,created_at,updated_at)
      VALUES
      ('model','ap','gpt-test','codex',1,1,'available','unknown',0,
       '2026-08-28T09:00:00Z','2026-08-28T09:00:00Z');
    INSERT INTO discovery_observations
      (id,provider_id,model_id,observed_json,source,confidence,observed_at,created_at)
      VALUES
      ('observation','ap','model','{"billingMode":"subscription_included"}','human','observed',
       '2026-08-28T09:00:00Z','2026-08-28T09:00:00Z');
    UPDATE agent_models SET billing_mode = 'subscription_included', updated_at = '2026-08-28T09:00:00Z'
    WHERE id = 'model';
  `);
  transitionTask(opened.db, 't', 'ready');
  transitionTask(opened.db, 't', 'queued');
  opened.sqlite.exec(`
    INSERT INTO task_claims
      (id,task_id,worker_id,attempt,status,lease_expires_at,heartbeat_at,created_at,updated_at)
      VALUES
      ('claim-1','t','worker-0',1,'completed','2026-08-28T10:00:00.000Z','2026-08-28T10:00:00.000Z','2026-08-28T09:00:00Z','2026-08-28T10:00:00Z'),
      ('claim','t','worker-1',2,'active','2099-01-01T00:00:00.000Z','2026-08-28T11:00:00.000Z','2026-08-28T09:59:00Z','2026-08-28T11:00:00Z');
  `);
  transitionTask(opened.db, 't', 'running', {
    fence: { claimId: 'claim', workerId: 'worker-1' },
  });
  transitionTask(opened.db, 't2', 'ready');
  transitionTask(opened.db, 't2', 'queued');
  transitionTask(opened.db, 't3', 'ready');
  transitionTask(opened.db, 't3', 'queued');
  transitionTask(opened.db, 't3', 'running');
  transitionTask(opened.db, 't3', 'failed');
  opened.sqlite.exec(`
    UPDATE tasks SET updated_at = CASE id
      WHEN 't' THEN '2026-08-28T10:00:00Z'
      WHEN 't2' THEN '2026-08-28T11:00:00Z'
      WHEN 't3' THEN '2026-08-28T11:00:00Z'
    END
    WHERE id IN ('t', 't2', 't3');
    INSERT INTO agent_runs
      (id,task_id,claim_id,claim_worker_id,provider_id,model_id,model_ref,purpose,billing_mode,
       routing_reason,status,session_ref,started_at,ended_at,created_at,updated_at)
      VALUES
      ('run','t','claim','worker-1','ap','model','gpt-test','implementation','subscription_included',
       'private route','succeeded','secret-session','2026-08-28T10:00:00Z','2026-08-28T10:00:12Z',
       '2026-08-28T10:00:00Z','2026-08-28T10:00:12Z');
    INSERT INTO usage_observations
      (id,provider_id,agent_run_id,kind,data_json,observed_at,created_at) VALUES
      ('tokens','ap','run','tokens','{"input":100,"output":20,"secret":"do-not-export"}',
       '2026-08-28T10:00:13Z','2026-08-28T10:00:13Z'),
      ('cost','ap','run','cost','{"estimatedCost":0.42,"currency":"USD","note":"do-not-export"}',
       '2026-08-28T10:00:14Z','2026-08-28T10:00:14Z');
    INSERT INTO verification_runs
      (id,task_id,agent_run_id,command,status,exit_code,output_summary,started_at,ended_at,created_at)
      VALUES
      ('verify','t','run','private test command','passed',0,'private output summary',
       '2026-08-28T10:00:15Z','2026-08-28T10:00:16Z','2026-08-28T10:00:15Z');
    INSERT INTO agent_run_events
      (id,run_id,seq,type,payload_hash,payload_json,created_at) VALUES
      ('event','run',1,'output','hash','{"email":"private@example.com","token":"secret"}',
       '2026-08-28T10:00:05Z');
  `);
  return opened;
}

describe('read-only Shaper observability adapter', () => {
  it('opens only an existing database in query-only mode without migrations or writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-shaper-readonly-'));
    const missing = join(root, 'missing', 'major.db');
    const existing = join(root, 'major.db');
    try {
      expect(() => openShaperTelemetryDb(missing)).toThrow();
      const created = new Database(existing);
      created.exec('CREATE TABLE marker (value text)');
      created.close();

      const sqlite = openShaperTelemetryDb(existing);
      try {
        expect(sqlite.pragma('query_only', { simple: true })).toBe(1);
        expect(
          sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all(),
        ).toEqual(['marker']);
        expect(() => sqlite.exec("INSERT INTO marker VALUES ('write')")).toThrow();
      } finally {
        sqlite.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed through runShaperCli without creating or migrating a database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'major-shaper-cli-readonly-'));
    const missing = join(root, 'missing.db');
    const outdated = join(root, 'outdated.db');
    const priorDbPath = process.env.MAJOR_DB_PATH;
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.env.MAJOR_DB_PATH = missing;
      await expect(runShaperCli(['telemetry', 'shaper'])).rejects.toThrow();
      expect(existsSync(missing)).toBe(false);
      expect(stdoutWrite).not.toHaveBeenCalled();

      const created = new Database(outdated);
      created.exec(
        "PRAGMA user_version = 1; CREATE TABLE marker (value text); INSERT INTO marker VALUES ('unchanged')",
      );
      created.close();
      const beforeBytes = readFileSync(outdated);
      const beforeMtime = statSync(outdated).mtimeMs;
      const beforeEntries = readdirSync(root).sort();

      process.env.MAJOR_DB_PATH = outdated;
      await expect(runShaperCli(['telemetry', 'shaper'])).rejects.toThrow(/no such table/);
      expect(readFileSync(outdated)).toEqual(beforeBytes);
      expect(statSync(outdated).mtimeMs).toBe(beforeMtime);
      expect(readdirSync(root).sort()).toEqual(beforeEntries);
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
      else process.env.MAJOR_DB_PATH = priorDbPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('projects known run telemetry and keeps unsupported or sensitive data unavailable', () => {
    const opened = seedTelemetry();
    try {
      opened.sqlite.pragma('query_only = ON');
      const rows = readShaperTelemetry(opened.sqlite, {
        asOf: '2026-08-28T12:00:00.000Z',
      });
      expect(rows).toEqual([
        expect.objectContaining({
          runId: 'run',
          project: 'demo',
          taskId: 't',
          taskStatus: 'running',
          taskFamily: null,
          runPurpose: 'implementation',
          worker: 'worker-1',
          provider: 'codex',
          providerAccount: 'work-account',
          model: 'gpt-test',
          durationSeconds: 12,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          estimatedCost: 0.42,
          costCurrency: 'USD',
          retryCount: 1,
          resultStatus: 'succeeded',
          approvalState: null,
          ciTestOutcome: 'passed',
          qualityScore: null,
          cacheReuseStatus: null,
          concurrency: null,
          queueWaitSeconds: null,
          eventCount: 1,
        }),
      ]);
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toMatch(
        /private@example|do-not-export|secret-session|private route|\/private\/client|private test command/,
      );
      expect(shaperTelemetryCsv(rows).split('\n')[1]).toBe(
        'run,2026-08-28,run,demo,t,running,,implementation,worker-1,codex,work-account,gpt-test,' +
          'subscription_included,2026-08-28T10:00:00Z,2026-08-28T10:00:12Z,12,100,20,120,0.42,USD,' +
          ',1,,,succeeded,,,,passed,,,,,1',
      );
    } finally {
      opened.sqlite.close();
    }
  });

  it('supports project and provider filters, command-centre counts, empty data, and bounds', () => {
    const opened = seedTelemetry();
    try {
      const asOf = '2026-08-28T12:00:00.000Z';
      expect(readShaperTelemetry(opened.sqlite, { asOf, project: 'other' })).toEqual([]);
      expect(readShaperTelemetry(opened.sqlite, { asOf, provider: 'missing' })).toEqual([]);
      expect(readShaperCommandCentre(opened.sqlite, { asOf, project: 'demo' })).toEqual([
        { metric: 'run_status', status: 'succeeded', count: 1, latestAt: '2026-08-28T10:00:12Z' },
        { metric: 'task_status', status: 'queued', count: 1, latestAt: '2026-08-28T11:00:00Z' },
        { metric: 'task_status', status: 'running', count: 1, latestAt: '2026-08-28T10:00:00Z' },
      ]);
      expect(shaperCommandCentreCsv(readShaperCommandCentre(opened.sqlite, { asOf }))).toContain(
        'task_status,queued,1,2026-08-28T11:00:00Z',
      );
      expect(readShaperTelemetry(opened.sqlite, { asOf, days: 1 })).toHaveLength(1);
      expect(readShaperTelemetry(opened.sqlite, { asOf, limit: 1 })).toHaveLength(1);
      expect(() => readShaperTelemetry(opened.sqlite, { asOf, days: 0 })).toThrow(/days/);
      expect(() => readShaperTelemetry(opened.sqlite, { asOf, limit: 50_001 })).toThrow(/limit/);
    } finally {
      opened.sqlite.close();
    }
  });

  it('uses an inclusive as-of cutoff and limits by full run timestamp then run id', () => {
    const opened = seedTelemetry();
    try {
      opened.sqlite.exec(`
        INSERT INTO agent_runs
          (id,task_id,provider_id,model_id,model_ref,purpose,billing_mode,routing_reason,status,
           started_at,ended_at,created_at,updated_at)
        VALUES
          ('run-before','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-27T11:59:59Z','2026-08-27T11:59:59Z','2026-08-27T11:59:59Z','2026-08-27T11:59:59Z'),
          ('run-window-boundary','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-27T12:00:00Z','2026-08-27T12:00:00Z','2026-08-27T12:00:00Z','2026-08-27T12:00:00Z'),
          ('run-early','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-28T11:00:00Z','2026-08-28T11:00:01Z','2026-08-28T11:00:00Z','2026-08-28T11:00:01Z'),
          ('run-late','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-28T11:59:59Z','2026-08-28T12:00:00Z','2026-08-28T11:59:59Z','2026-08-28T12:00:00Z'),
          ('run-boundary-a','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-28T12:00:00Z','2026-08-28T12:00:00Z','2026-08-28T12:00:00Z','2026-08-28T12:00:00Z'),
          ('run-boundary-b','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-28T12:00:00Z','2026-08-28T12:00:00Z','2026-08-28T12:00:00Z','2026-08-28T12:00:00Z'),
          ('run-future','t','ap','model','gpt-test','implementation','subscription_included','test','succeeded',
           '2026-08-28T12:00:01Z','2026-08-28T12:00:01Z','2026-08-28T12:00:01Z','2026-08-28T12:00:01Z');
        INSERT INTO tasks (id,project_id,title,description,status,complexity,version,created_at,updated_at)
        VALUES
          ('t-boundary','p','boundary','boundary','draft','routine',0,'2026-08-28T12:00:00Z','2026-08-28T12:00:00Z'),
          ('t-future','p','future','future','draft','routine',0,'2026-08-28T12:00:01Z','2026-08-28T12:00:01Z');
      `);
      const window = { asOf: '2026-08-28T12:00:00Z', days: 1 };
      expect(readShaperTelemetry(opened.sqlite, window).map((row) => row.runId)).toEqual([
        'run-boundary-a',
        'run-boundary-b',
        'run-late',
        'run-early',
        'run',
        'run-window-boundary',
      ]);
      const options = { ...window, limit: 2 };
      expect(readShaperTelemetry(opened.sqlite, options).map((row) => row.runId)).toEqual([
        'run-boundary-a',
        'run-boundary-b',
      ]);
      expect(readShaperCommandCentre(opened.sqlite, options)).toContainEqual({
        metric: 'run_status',
        status: 'succeeded',
        count: 6,
        latestAt: '2026-08-28T12:00:00Z',
      });
      expect(readShaperCommandCentre(opened.sqlite, options)).toContainEqual({
        metric: 'task_status',
        status: 'draft',
        count: 1,
        latestAt: '2026-08-28T12:00:00Z',
      });
    } finally {
      opened.sqlite.close();
    }
  });

  it('neutralizes CSV formulas after whitespace/control prefixes and preserves ordinary strings', () => {
    const csv = shaperCommandCentreCsv([
      { metric: 'run_status', status: '=cmd()', count: 1, latestAt: '+SUM(A1)' },
      { metric: 'run_status', status: '\t=tab()', count: 2, latestAt: '\r@carriage' },
      { metric: 'run_status', status: '\u0001+control', count: 3, latestAt: '   -whitespace' },
      { metric: 'run_status', status: 'ordinary whitespace', count: 4, latestAt: '  unchanged' },
      { metric: 'run_status', status: 'comma,value', count: 5, latestAt: 'say "hello"' },
      { metric: 'run_status', status: 'first line\nsecond line', count: 6, latestAt: null },
    ]);
    expect(csv).toContain("run_status,'=cmd(),1,'+SUM(A1)");
    expect(csv).toContain("run_status,'\t=tab(),2,\"'\r@carriage\"");
    expect(csv).toContain("run_status,'\u0001+control,3,'   -whitespace");
    expect(csv).toContain('run_status,ordinary whitespace,4,  unchanged');
    expect(csv).toContain('run_status,"comma,value",5,"say ""hello"""');
    expect(csv).toContain('run_status,"first line\nsecond line",6,');
  });

  it('returns an empty result for an empty database without network or writes', () => {
    const opened = openDb(':memory:');
    try {
      opened.sqlite.pragma('query_only = ON');
      expect(readShaperTelemetry(opened.sqlite, { asOf: '2026-08-28T12:00:00.000Z' })).toEqual([]);
      expect(readShaperCommandCentre(opened.sqlite, { asOf: '2026-08-28T12:00:00.000Z' })).toEqual(
        [],
      );
    } finally {
      opened.sqlite.close();
    }
  });
});
