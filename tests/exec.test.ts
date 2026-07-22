import { describe, expect, it } from 'vitest';
import { executeStreaming } from '../src/providers/exec.js';
import { PathViolationError } from '../src/security/paths.js';

const NODE = process.execPath;

function nodeScript(source: string) {
  return {
    executable: NODE,
    args: ['-e', source],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '' },
  };
}

describe('streamed execution', () => {
  it('streams NDJSON lines as structured events and captures the session ref', async () => {
    const handle = executeStreaming({
      ...nodeScript(
        `console.log(JSON.stringify({type:'system',session_id:'sess-42'}));` +
          `console.log(JSON.stringify({type:'result',usage:{output_tokens:7}}));`,
      ),
      extractSessionRef: (e) => (e.data as { session_id?: string }).session_id,
      extractUsage: (e) => {
        const d = e.data as { type?: string; usage?: unknown };
        return d.type === 'result' ? d.usage : undefined;
      },
    });
    const events = [];
    for await (const event of handle.events) events.push(event);
    const outcome = await handle.outcome;
    expect(events.map((e) => e.type)).toEqual(['system', 'result']);
    expect(outcome.status).toBe('succeeded');
    expect(outcome.sessionRef).toBe('sess-42');
    expect(outcome.usage).toEqual({ output_tokens: 7 });
  });

  it('detects rate limiting from stderr', async () => {
    const handle = executeStreaming({
      ...nodeScript(`console.error('429 too many requests'); process.exit(1);`),
      detectRateLimit: (text) => /429/.test(text),
      detectExhaustion: (text) => /quota exceeded/.test(text),
    });
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('failed');
    expect(outcome.rateLimited).toBe(true);
    expect(outcome.exhausted).toBe(false);
  });

  it('times out long-running processes', async () => {
    const handle = executeStreaming({
      ...nodeScript(`setTimeout(() => {}, 60000);`),
      timeoutMs: 300,
    });
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('timed_out');
  }, 15000);

  it('supports cancellation', async () => {
    const handle = executeStreaming(nodeScript(`setTimeout(() => {}, 60000);`));
    setTimeout(() => handle.cancel(), 100);
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('cancelled');
  }, 15000);

  it('refuses to run outside configured roots', () => {
    expect(() =>
      executeStreaming({ ...nodeScript('1'), cwd: '/etc', allowedRoots: ['/tmp/proj'] }),
    ).toThrow(PathViolationError);
  });

  it('redacts secrets from the captured stderr tail', async () => {
    const handle = executeStreaming(
      nodeScript(`console.error('token=ghp_abcdefghijklmnopqrstuvwxyz123456'); process.exit(1);`),
    );
    const outcome = await handle.outcome;
    expect(outcome.stderrTail).not.toContain('ghp_abcdef');
  });
});
