import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { agentProviders, agentRunEvents } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import {
  appendRunEvent,
  ConflictingEventError,
  createRun,
  listRunEvents,
} from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { seedProject, tempDbPath, testDb } from './helpers.js';

function seedRun(db: ReturnType<typeof testDb>) {
  const project = seedProject(db);
  const task = addTask(db, { projectId: project.id, title: 'work' });
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
  return createRun(db, {
    taskId: task.id,
    providerId,
    modelRef: 'sonnet',
    purpose: 'implementation',
    billingMode: 'subscription_included',
    routingReason: 'test',
  });
}

describe('immutable run events', () => {
  it('blocks UPDATE and DELETE on a file-backed database across connections', () => {
    const path = tempDbPath();
    const a = openDb(path).db;
    const run = seedRun(a);
    appendRunEvent(a, run.id, 'started', { pid: 1 });

    const b = openDb(path).db;
    expect(() => b.update(agentRunEvents).set({ type: 'tampered' }).run()).toThrow(/append-only/);
    expect(() => b.delete(agentRunEvents).run()).toThrow(/append-only/);
    expect(listRunEvents(b, run.id)).toHaveLength(1);
  });

  it('treats redelivery of an identical keyed event as an idempotent no-op', () => {
    const db = testDb();
    const run = seedRun(db);
    const first = appendRunEvent(db, run.id, 'message', { text: 'hi' }, { eventKey: 'msg-1' });
    const again = appendRunEvent(db, run.id, 'message', { text: 'hi' }, { eventKey: 'msg-1' });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.event.id).toBe(first.event.id);
    expect(listRunEvents(db, run.id)).toHaveLength(1);
  });

  it('rejects a conflicting replacement under the same event key', () => {
    const db = testDb();
    const run = seedRun(db);
    appendRunEvent(db, run.id, 'message', { text: 'original' }, { eventKey: 'msg-1' });
    expect(() =>
      appendRunEvent(db, run.id, 'message', { text: 'REWRITTEN HISTORY' }, { eventKey: 'msg-1' }),
    ).toThrow(ConflictingEventError);
  });

  it('assigns collision-safe identity: per-run seq survives concurrent appenders', () => {
    const path = tempDbPath();
    const a = openDb(path).db;
    const run = seedRun(a);
    const b = openDb(path).db;
    // interleave appends from two connections
    appendRunEvent(a, run.id, 'e', { n: 1 });
    appendRunEvent(b, run.id, 'e', { n: 2 });
    appendRunEvent(a, run.id, 'e', { n: 3 });
    appendRunEvent(b, run.id, 'e', { n: 4 });
    const events = listRunEvents(a, run.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(new Set(events.map((e) => e.id)).size).toBe(4);
  });

  it('redacts secrets BEFORE persistence — durable storage never sees them', () => {
    const path = tempDbPath();
    const db = openDb(path).db;
    const run = seedRun(db);
    appendRunEvent(db, run.id, 'tool_result', {
      output: 'token=ghp_abcdefghijklmnopqrstuvwxyz123456',
      nested: { apiKey: 'sk-ant-supersecret1234567890' },
    });
    // read the raw persisted bytes with a completely fresh connection
    const raw = openDb(path).sqlite.prepare('SELECT payload_json FROM agent_run_events').all() as {
      payload_json: string;
    }[];
    const persisted = raw.map((r) => r.payload_json).join('\n');
    expect(persisted).not.toContain('ghp_abcdef');
    expect(persisted).not.toContain('supersecret');
    expect(persisted).toContain('[REDACTED]');
  });

  function persistedBytes(path: string): string {
    const raw = openDb(path).sqlite.prepare('SELECT payload_json FROM agent_run_events').all() as {
      payload_json: string;
    }[];
    return raw.map((r) => r.payload_json).join('\n');
  }

  it('multi-part and structured secret values leave no recoverable fragment', () => {
    const path = tempDbPath();
    const db = openDb(path).db;
    const run = seedRun(db);
    appendRunEvent(db, run.id, 'provider_stdout', {
      // whole-value redaction by sensitive key: every fragment must vanish,
      // even parts that match no known token format
      password: 'correct horse battery staple',
      // a sensitive key holding a structured value: the WHOLE subtree goes,
      // fail closed, even the parts that look innocent
      credentials: {
        user: 'svc-secret-user',
        private_key: 'part-one part-two part-three',
      },
      context: { user: 'svc-roadmap' },
      // sensitive key holding a structured value: the whole subtree goes
      auth: { header: 'Basic QWxhZGRpbjpvcGVuc2VzYW1l', renewal: { token: 'zzz' } },
      // free text with a quoted multi-word secret (secondary pattern layer)
      stderr: 'login failed: api_key: "alpha beta gamma delta" rejected by upstream',
      harmless: 'exit code 0',
    });
    const persisted = persistedBytes(path);
    for (const fragment of [
      'correct horse',
      'battery staple',
      'svc-secret-user',
      'part-one',
      'part-two',
      'part-three',
      'QWxhZGRpbjpvcGVuc2VzYW1l',
      'zzz',
      'alpha beta',
      'gamma delta',
    ]) {
      expect(persisted).not.toContain(fragment);
    }
    // non-secret context survives
    expect(persisted).toContain('svc-roadmap');
    expect(persisted).toContain('exit code 0');
    // and what persisted is still valid JSON
    for (const line of persisted.split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('provider stderr/errors are redacted before durable storage', () => {
    const path = tempDbPath();
    const db = openDb(path).db;
    const run = seedRun(db);
    appendRunEvent(db, run.id, 'provider_failed', {
      error:
        'request rejected: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop',
      stderrTail: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY was set',
    });
    const persisted = persistedBytes(path);
    expect(persisted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(persisted).not.toContain('wJalrXUtnFEMIK7MDENG');
  });

  it('fails closed: an unredactable payload is withheld, not persisted raw', () => {
    const path = tempDbPath();
    const db = openDb(path).db;
    const run = seedRun(db);
    const circular: Record<string, unknown> = { note: 'ghp_abcdefghijklmnopqrstuvwxyz123456' };
    circular.self = circular;
    appendRunEvent(db, run.id, 'weird', circular);
    const persisted = persistedBytes(path);
    expect(persisted).not.toContain('ghp_abcdef');
  });
});
