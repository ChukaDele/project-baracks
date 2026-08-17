import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  CODEX_APP_SERVER_METHODS,
  encodeCodexAppServerMessage,
  parseCodexAccount,
  parseCodexAppServerSnapshot,
  parseCodexRateLimits,
  queryCodexAppServer,
} from '../src/providers/codex-app-server.js';

function fakeAppServer(handler: (message: Record<string, unknown>) => unknown) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const received: Record<string, unknown>[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      received.push(message);
      const result = handler(message);
      if (message.id === undefined) continue;
      stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
    }
  });
  return { stdin, stdout, received };
}

describe('Codex App Server protocol', () => {
  it('calls initialize, account/read and account/rateLimits/read on a live session', async () => {
    const { stdin, stdout, received } = fakeAppServer((message) => {
      if (message.method === CODEX_APP_SERVER_METHODS.initialize) {
        return { protocolVersion: 1 };
      }
      if (message.method === CODEX_APP_SERVER_METHODS.accountRead) {
        expect(message.params).toEqual({ refreshToken: false });
        expect(message).not.toHaveProperty('jsonrpc');
        return {
          account: { type: 'chatgpt', email: 'owner@example.com', planType: 'plus' },
          requiresOpenaiAuth: true,
        };
      }
      if (message.method === CODEX_APP_SERVER_METHODS.accountRateLimitsRead) {
        return {
          rateLimits: {
            primary: { usedPercent: 42.2, windowDurationMins: 300, resetsAt: 1_780_000_000 },
            secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: 1_780_500_000 },
          },
        };
      }
      return {};
    });

    const snapshot = await queryCodexAppServer(stdin, stdout);
    expect(snapshot).toEqual({
      planType: 'plus',
      accountKind: 'chatgpt',
      primary: { usedPercent: 42.2, windowDurationMins: 300, resetsAt: 1_780_000_000 },
      secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: 1_780_500_000 },
    });
    expect(snapshot).not.toHaveProperty('email');
    expect(received.map((message) => message.method)).toEqual([
      CODEX_APP_SERVER_METHODS.initialize,
      CODEX_APP_SERVER_METHODS.initialized,
      CODEX_APP_SERVER_METHODS.accountRead,
      CODEX_APP_SERVER_METHODS.accountRateLimitsRead,
    ]);
    expect(received.every((message) => !('jsonrpc' in message))).toBe(true);
    expect(received.find((message) => message.method === 'initialized')).not.toHaveProperty(
      'params',
    );
    expect(encodeCodexAppServerMessage({ method: 'initialized' })).toBe(
      '{"method":"initialized"}\n',
    );
    expect(
      received.find((message) => message.method === 'account/rateLimits/read'),
    ).not.toHaveProperty('params');
    expect(
      encodeCodexAppServerMessage({
        method: 'account/read',
        id: 1,
        params: { refreshToken: false },
      }),
    ).toBe('{"method":"account/read","id":1,"params":{"refreshToken":false}}\n');
    expect(encodeCodexAppServerMessage({ method: 'account/rateLimits/read', id: 7 })).toBe(
      '{"method":"account/rateLimits/read","id":7}\n',
    );
  });

  it('parses official account/read and account/rateLimits/read README payloads without emails', () => {
    const snapshot = parseCodexAppServerSnapshot(
      {
        account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro' },
        requiresOpenaiAuth: true,
      },
      {
        rateLimits: {
          primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_730_947_200 },
          secondary: null,
          rateLimitReachedType: null,
        },
      },
    );
    expect(snapshot).toEqual({
      planType: 'pro',
      accountKind: 'chatgpt',
      primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1_730_947_200 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/@|token|sk-/i);
  });

  it('parses camelCase and snake_case account/rate-limit payloads', () => {
    expect(
      parseCodexAccount({
        account: { type: 'chatgpt', email: 'owner@example.com', planType: 'plus' },
      }),
    ).toEqual({ planType: 'plus', accountKind: 'chatgpt' });
    expect(
      parseCodexRateLimits({
        rate_limits: { primary: { used_percent: 9, window_duration_mins: 300, resets_at: 99 } },
      }),
    ).toEqual({ primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 99 } });
  });

  it('surfaces a JSON-RPC error from account/rateLimits/read', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; method?: string };
        if (message.id === undefined) continue;
        if (message.method === CODEX_APP_SERVER_METHODS.accountRateLimitsRead) {
          stdout.write(
            `${JSON.stringify({
              id: message.id,
              error: { message: 'chatgpt authentication required to read rate limits' },
            })}\n`,
          );
          continue;
        }
        stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
      }
    });
    await expect(queryCodexAppServer(stdin, stdout)).rejects.toThrow(
      /chatgpt authentication required/,
    );
  });

  it('waits after initialized before account reads when readyDelayMs is set', async () => {
    let initializedAt = 0;
    let accountReadAt = 0;
    const { stdin, stdout, received } = fakeAppServer((message) => {
      if (message.method === CODEX_APP_SERVER_METHODS.initialize) return { protocolVersion: 1 };
      if (message.method === CODEX_APP_SERVER_METHODS.initialized) {
        initializedAt = Date.now();
        return {};
      }
      if (message.method === CODEX_APP_SERVER_METHODS.accountRead) {
        accountReadAt = Date.now();
        return { account: { type: 'chatgpt', planType: 'plus' } };
      }
      if (message.method === CODEX_APP_SERVER_METHODS.accountRateLimitsRead) {
        return { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300 } } };
      }
      return {};
    });

    const snapshot = await queryCodexAppServer(stdin, stdout, { readyDelayMs: 60 });
    expect(snapshot.planType).toBe('plus');
    expect(snapshot.primary).toEqual({ usedPercent: 1, windowDurationMins: 300 });
    expect(received.map((message) => message.method)).toEqual([
      CODEX_APP_SERVER_METHODS.initialize,
      CODEX_APP_SERVER_METHODS.initialized,
      CODEX_APP_SERVER_METHODS.accountRead,
      CODEX_APP_SERVER_METHODS.accountRateLimitsRead,
    ]);
    expect(initializedAt).toBeGreaterThan(0);
    expect(accountReadAt).toBeGreaterThan(initializedAt);
    expect(accountReadAt - initializedAt).toBeGreaterThanOrEqual(50);
  });
});
