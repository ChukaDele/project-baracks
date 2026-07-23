import { describe, expect, it } from 'vitest';
import { executeStreaming } from '../src/providers/exec.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';

/**
 * The raw streaming spawn engine is quarantined in this build: live agent
 * execution is an unavailable capability, so executeStreaming refuses
 * synchronously — before any child process can be created — regardless of the
 * spec it is given. The streaming/timeout/cancellation machinery is deferred
 * to milestone M1 together with the capability.
 */
describe('executeStreaming is disabled (live-agent-execution unavailable)', () => {
  it('throws synchronously before any spawn, for any spec', () => {
    expect(() =>
      executeStreaming({
        executable: process.execPath,
        args: ['-e', 'console.log("must never run")'],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? '' },
      }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('the refusal is not influenced by environment variables', () => {
    const previous = process.env.MAJOR_ENABLE_LIVE_EXECUTION;
    process.env.MAJOR_ENABLE_LIVE_EXECUTION = '1';
    try {
      expect(() =>
        executeStreaming({
          executable: process.execPath,
          args: ['-e', '1'],
          cwd: process.cwd(),
          env: { PATH: process.env.PATH ?? '' },
        }),
      ).toThrow(CapabilityUnavailableError);
    } finally {
      if (previous === undefined) delete process.env.MAJOR_ENABLE_LIVE_EXECUTION;
      else process.env.MAJOR_ENABLE_LIVE_EXECUTION = previous;
    }
  });
});
