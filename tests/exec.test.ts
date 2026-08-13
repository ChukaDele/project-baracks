import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeStreaming } from '../src/providers/exec.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';

describe('streaming execution engine release gate', () => {
  it('refuses before spawning a structured-output child', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'major-stream-'));
    expect(() =>
      executeStreaming({
        executable: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({type:"message",value:"ok"}))'],
        cwd,
        allowedRoots: [cwd],
        env: { PATH: process.env.PATH ?? '' },
      }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('does not expose a parent secret because no child can start', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'major-stream-env-'));
    const previous = process.env.MAJOR_PARENT_ONLY_SECRET;
    process.env.MAJOR_PARENT_ONLY_SECRET = 'must-not-inherit';
    try {
      expect(() =>
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
      ).toThrow(CapabilityUnavailableError);
    } finally {
      if (previous === undefined) delete process.env.MAJOR_PARENT_ONLY_SECRET;
      else process.env.MAJOR_PARENT_ONLY_SECRET = previous;
    }
  });
});
