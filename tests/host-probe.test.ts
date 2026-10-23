import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  responses: new Map<string, { code: number | null; output: string }>(),
  calls: [] as Array<{ executable: string; args: readonly string[] }>,
  keychain: false,
  token: undefined as string | undefined,
}));

vi.mock('../src/providers/host-credential.js', () => ({
  keychainServiceName: (host: string) =>
    host === 'claude' ? 'Claude Code-credentials' : undefined,
  hasKeychainEntry: () => state.keychain,
}));

vi.mock('../src/providers/provider-token.js', () => ({
  readProviderToken: () => state.token,
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

  it('reports a Keychain-only login with the exact owner command', async () => {
    state.calls.length = 0;
    state.responses.clear();
    state.keychain = true;
    state.token = undefined;
    state.responses.set('--version', { code: 0, output: 'claude 2.1.233' });
    state.responses.set('auth status --json', {
      code: 1,
      output: '{"loggedIn":false,"authMethod":"none"}',
    });

    const status = await probeHostProvider('claude');
    expect(status.authenticated).toBe(false);
    expect(status.detail).toMatch(/^host-keychain-only:/);
    expect(status.detail).toContain('claude setup-token');
    expect(status.detail).toContain('major provider import-token claude-code');
    state.keychain = false;
  });

  it('authenticates when a Major-held token reaches the CLI', async () => {
    state.calls.length = 0;
    state.responses.clear();
    state.keychain = true;
    state.token = 'sk-ant-oat01-FAKEfakeFAKEfake0123456789';
    state.responses.set('--version', { code: 0, output: 'claude 2.1.233' });
    state.responses.set('auth status --json', {
      code: 0,
      output: '{"loggedIn":true,"authMethod":"oauth_token"}',
    });

    await expect(probeHostProvider('claude')).resolves.toMatchObject({
      authenticated: true,
      detail: 'provider is installed and authenticated through the host CLI',
    });
    state.keychain = false;
    state.token = undefined;
  });

  it('probes Antigravity with a real agy command and names the sandbox blocker', async () => {
    state.calls.length = 0;
    state.responses.clear();
    state.responses.set('--version', { code: 0, output: 'agy 1.4.5' });
    state.responses.set('models', {
      code: 1,
      output: 'Failed to start: listen tcp 127.0.0.1:0: bind: operation not permitted',
    });
    const blocked = await probeHostProvider('antigravity');
    expect(state.calls.map((call) => call.args)).toEqual([['--version'], ['models']]);
    expect(blocked).toMatchObject({ authenticated: false });
    expect(blocked.detail).toMatch(/^sandbox-blocked:/);

    state.responses.set('models', {
      code: 0,
      output: 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)',
    });
    await expect(probeHostProvider('antigravity')).resolves.toMatchObject({ authenticated: true });
  });
});
