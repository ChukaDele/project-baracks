import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { executeStreaming } from '../src/providers/exec.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';

// executeStreaming's own capability gate is a defense-in-depth backstop
// beneath the gateway, exercised here at its pre-activation value regardless
// of this build's real (now active) live-agent-execution state — see
// tests/activated-capabilities.test.ts for the real-value assertion.
vi.mock('../src/security/capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/security/capabilities.js')>();
  const isCapabilityAvailable = (capability: string) =>
    capability === 'live-agent-execution'
      ? false
      : actual.isCapabilityAvailable(capability as never);
  return {
    ...actual,
    isCapabilityAvailable,
    // Reimplemented against the override above: assertCapabilityAvailable's
    // real body closes over the real module's own isCapabilityAvailable, so
    // spreading actual.assertCapabilityAvailable here would silently ignore
    // this mock.
    assertCapabilityAvailable: (capability: string) => {
      if (!isCapabilityAvailable(capability)) {
        throw new actual.CapabilityUnavailableError(capability as never);
      }
    },
  };
});

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
