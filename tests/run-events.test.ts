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
});
