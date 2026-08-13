import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { agentProviders, agentRunEvents } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { createRun, appendRunEvent, listRunEvents } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { isSensitiveKey, redactValue } from '../src/security/redact.js';
import { ensureObservedModel, seedProject } from './helpers.js';

/**
 * P1-5 reproducer: structural redaction must recognise compound / camelCase
 * secret key names and drop their COMPLETE value before persistence. An
 * opaque multi-part value under such a key matches no token-format pattern,
 * so pattern redaction (the secondary defence) cannot catch it — only correct
 * key normalisation removes it.
 */

// Opaque high-entropy values that match NONE of the token-format regexes.
const OPAQUE = 'Zx7Q-r4Tm-9kLp-2Wc8-Ha1N-e6Yv-b3Rd-0Fj5';

const COMPOUND_SECRET_KEYS = [
  'authToken',
  'accessToken',
  'bearerToken',
  'AuthToken',
  'access_token',
  'access-token',
  'Authorization',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'privateKey',
  'clientSecret',
];

describe('P1-5 compound sensitive-key redaction', () => {
  it('recognises compound / camelCase secret key names', () => {
    for (const key of COMPOUND_SECRET_KEYS) {
      expect(isSensitiveKey(key), `expected ${key} to be sensitive`).toBe(true);
    }
  });

  it('drops the complete value under a compound key (no fragment survives)', () => {
    for (const key of COMPOUND_SECRET_KEYS) {
      const redacted = redactValue({ [key]: OPAQUE }) as Record<string, unknown>;
      expect(JSON.stringify(redacted), `value leaked under ${key}`).not.toContain(OPAQUE);
      // no identifiable fragment either
      expect(JSON.stringify(redacted)).not.toContain(OPAQUE.slice(0, 8));
    }
  });

  it('sanitises nested objects, arrays, provider responses and errors', () => {
    const payload = {
      providerResponse: {
        headers: [{ Authorization: `Bearer ${OPAQUE}` }, { 'X-Auth-Token': OPAQUE }],
        nested: { deep: { authToken: OPAQUE } },
      },
      error: new Error(`boom with accessToken=${OPAQUE}`),
      stdout: `logged authToken: ${OPAQUE}`,
    };
    const out = JSON.stringify(redactValue(payload));
    expect(out).not.toContain(OPAQUE);
    expect(out).not.toContain(OPAQUE.slice(0, 8));
  });

  it('does not survive persistence to the agent_run_events table', () => {
    const db = openDb(':memory:').db;
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'redact' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'p' }).run();
    ensureObservedModel(db, providerId);
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test',
    });
    appendRunEvent(db, run.id, 'result', {
      authToken: OPAQUE,
      accessToken: OPAQUE,
      detail: { bearerToken: OPAQUE },
    });
    const [event] = listRunEvents(db, run.id);
    const rawRows = db.select().from(agentRunEvents).all();
    expect(event!.payloadJson).not.toContain(OPAQUE);
    expect(JSON.stringify(rawRows)).not.toContain(OPAQUE.slice(0, 8));
  });
});
