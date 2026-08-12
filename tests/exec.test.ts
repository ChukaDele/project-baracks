import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeStreaming } from '../src/providers/exec.js';

async function collect(handle: ReturnType<typeof executeStreaming>) {
  const events = [];
  for await (const event of handle.events) events.push(event);
  return { events, outcome: await handle.outcome };
}

describe('activated streaming execution engine', () => {
  it('streams structured output and reports a successful outcome', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'major-stream-'));
    const result = await collect(
      executeStreaming({
        executable: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({type:"message",value:"ok"}))'],
        cwd,
        allowedRoots: [cwd],
        env: { PATH: process.env.PATH ?? '' },
      }),
    );
    expect(result.outcome).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(result.events).toEqual([{ type: 'message', data: { type: 'message', value: 'ok' } }]);
  });

  it('passes only the explicit child environment', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'major-stream-env-'));
    const previous = process.env.MAJOR_PARENT_ONLY_SECRET;
    process.env.MAJOR_PARENT_ONLY_SECRET = 'must-not-inherit';
    try {
      const result = await collect(
        executeStreaming({
          executable: process.execPath,
          args: [
            '-e',
            'console.log(JSON.stringify({type:"env",value:process.env.MAJOR_PARENT_ONLY_SECRET??null}))',
          ],
          cwd,
          allowedRoots: [cwd],
          env: { PATH: process.env.PATH ?? '' },
        }),
      );
      expect(result.outcome.status).toBe('succeeded');
      expect(result.events).toEqual([{ type: 'env', data: { type: 'env', value: null } }]);
    } finally {
      if (previous === undefined) delete process.env.MAJOR_PARENT_ONLY_SECRET;
      else process.env.MAJOR_PARENT_ONLY_SECRET = previous;
    }
  });
});
