import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  responses: new Map<string, { code: number | null; output: string }>(),
  calls: [] as Array<{ executable: string; args: readonly string[] }>,
}));

vi.mock('../src/security/major-gateway.js', () => ({
  executeMajorCommand: (request: { executable: string; args: readonly string[] }) => {
    state.calls.push({ executable: request.executable, args: request.args });
    const response = state.responses.get(request.args.join(' ')) ?? { code: 1, output: '' };
    return {
      events: (async function* () {
        if (response.output) yield { type: 'raw', data: response.output };
      })(),
      cancel: () => undefined,
      outcome: Promise.resolve({
        status: response.code === 0 ? 'succeeded' : 'failed',
        exitCode: response.code,
        rateLimited: false,
        exhausted: false,
        stderrTail: '',
      }),
    };
  },
}));

import { probeHostProvider } from '../src/providers/host-probe.js';

describe('host provider probe', () => {
  it('proves an installed and authenticated Codex CLI through Major gateway calls', async () => {
    state.calls.length = 0;
    state.responses.clear();
    state.responses.set('--version', { code: 0, output: 'codex-cli 0.147.0' });
    state.responses.set('login status', { code: 0, output: 'Logged in using ChatGPT' });

    await expect(probeHostProvider('codex')).resolves.toMatchObject({
      executable: 'codex',
      installed: true,
      authenticated: true,
      version: '0.147.0',
    });
    expect(state.calls.map((call) => call.args)).toEqual([['--version'], ['login', 'status']]);
  });

  it('does not turn an unauthenticated host CLI into a READY signal', async () => {
    state.calls.length = 0;
    state.responses.clear();
    state.responses.set('--version', { code: 0, output: 'claude 2.1.233' });
    state.responses.set('auth status --json', {
      code: 0,
      output: '{"loggedIn":false}',
    });

    await expect(probeHostProvider('claude')).resolves.toMatchObject({
      executable: 'claude',
      installed: true,
      authenticated: false,
    });
  });
});
