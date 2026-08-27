/**
 * Official Codex App Server JSON-RPC client.
 *
 * Speaks only the documented account methods over an already-opened stdio
 * transport. Callers own process spawn, credential materialization and
 * teardown so this module cannot change routing or authentication.
 *
 * Wire format matches the official app-server protocol: JSONL without the
 * `"jsonrpc":"2.0"` header. `account/read` uses `refreshToken: false` so a
 * usage poll cannot mutate stored credentials.
 *
 * Methods: initialize, initialized, account/read, account/rateLimits/read.
 */

import type { Readable, Writable } from 'node:stream';

export const CODEX_APP_SERVER_METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
  accountRead: 'account/read',
  accountRateLimitsRead: 'account/rateLimits/read',
} as const;

export interface CodexRateLimitWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface CodexAppServerSnapshot {
  planType?: string;
  accountKind?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
}

export interface CodexAppServerClientInfo {
  name: string;
  title: string;
  version: string;
}

const DEFAULT_CLIENT_INFO: CodexAppServerClientInfo = {
  name: 'major',
  title: 'Major',
  version: '0.5.3',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonRpcErrorMessage(error: unknown): string {
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return 'Codex app-server request failed';
}

/** Wait for the guest `codex app-server` process to open stdio. */
export const CODEX_APP_SERVER_STARTUP_DELAY_MS = 250;

/**
 * Wait after `initialized` before account reads. Live quota clients observe
 * empty `account/rateLimits/read` payloads when this gap is skipped.
 */
export const CODEX_APP_SERVER_READY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Codex app-server ${method} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function planTypeName(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct) return direct;
  if (isRecord(value)) {
    return asString(value.name) ?? asString(value.planType) ?? asString(value.plan_type);
  }
  return undefined;
}

export function parseCodexAccount(
  result: unknown,
): Pick<CodexAppServerSnapshot, 'planType' | 'accountKind'> {
  const root = isRecord(result) ? result : {};
  const account = isRecord(root.account) ? root.account : root;
  const tagged = asString(account.type) ?? asString(account.kind);
  const chatgpt = isRecord(account.chatgpt) ? account.chatgpt : undefined;
  const planType =
    planTypeName(account.planType) ??
    planTypeName(account.plan_type) ??
    planTypeName(chatgpt?.planType) ??
    planTypeName(chatgpt?.plan_type);
  const accountKind =
    tagged ?? (chatgpt ? 'chatgpt' : (asString(account.authMode) ?? asString(account.auth_mode)));
  return {
    ...(planType ? { planType } : {}),
    ...(accountKind ? { accountKind } : {}),
  };
}

export function parseRateLimitWindow(value: unknown): CodexRateLimitWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = asNumber(value.usedPercent) ?? asNumber(value.used_percent);
  const windowDurationMins =
    asNumber(value.windowDurationMins) ?? asNumber(value.window_duration_mins);
  let resetsAt = asNumber(value.resetsAt) ?? asNumber(value.resets_at);
  if (resetsAt !== undefined && resetsAt > 1e12) resetsAt = Math.round(resetsAt / 1000);
  if (usedPercent === undefined && windowDurationMins === undefined && resetsAt === undefined) {
    return undefined;
  }
  return {
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

export function parseCodexRateLimits(
  result: unknown,
): Pick<CodexAppServerSnapshot, 'primary' | 'secondary'> {
  const root = isRecord(result) ? result : {};
  const snapshot = isRecord(root.rateLimits)
    ? root.rateLimits
    : isRecord(root.rate_limits)
      ? root.rate_limits
      : root;
  const primary = parseRateLimitWindow(snapshot.primary);
  const secondary = parseRateLimitWindow(snapshot.secondary);
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

export function parseCodexAppServerSnapshot(
  accountResult: unknown,
  rateLimitResult: unknown,
): CodexAppServerSnapshot {
  return {
    ...parseCodexAccount(accountResult),
    ...parseCodexRateLimits(rateLimitResult),
  };
}

/**
 * Encode one official app-server JSONL frame. The protocol omits
 * `"jsonrpc":"2.0"` on the wire and omits `params` when the method has none.
 */
export function encodeCodexAppServerMessage(message: {
  method: string;
  id?: number;
  params?: Record<string, unknown>;
}): string {
  const body: Record<string, unknown> = { method: message.method };
  if (message.id !== undefined) body.id = message.id;
  if (message.params !== undefined) body.params = message.params;
  return `${JSON.stringify(body)}\n`;
}

/**
 * Drive one Codex `app-server` stdio session through the official account
 * and rate-limit methods. The transport is already authenticated by the
 * caller's HOME/credential slot.
 */
export async function queryCodexAppServer(
  stdin: Writable,
  stdout: Readable,
  options: {
    timeoutMs?: number;
    startupDelayMs?: number;
    readyDelayMs?: number;
    clientInfo?: CodexAppServerClientInfo;
  } = {},
): Promise<CodexAppServerSnapshot> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;
  const startupDelayMs = options.startupDelayMs ?? 0;
  const readyDelayMs = options.readyDelayMs ?? 0;
  await delay(startupDelayMs);
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let buffer = '';

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(parsed) || parsed.id === undefined) continue;
      const waiter = pending.get(Number(parsed.id));
      if (!waiter) continue;
      pending.delete(Number(parsed.id));
      if (parsed.error !== undefined) waiter.reject(new Error(jsonRpcErrorMessage(parsed.error)));
      else waiter.resolve(parsed.result);
    }
  };
  stdout.on('data', onData);

  const request = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    stdin.write(
      encodeCodexAppServerMessage(params === undefined ? { method, id } : { method, id, params }),
    );
    return withTimeout(result, timeoutMs, method);
  };

  try {
    await request(CODEX_APP_SERVER_METHODS.initialize, { clientInfo });
    stdin.write(encodeCodexAppServerMessage({ method: CODEX_APP_SERVER_METHODS.initialized }));
    await delay(readyDelayMs);
    const account = await request(CODEX_APP_SERVER_METHODS.accountRead, { refreshToken: false });
    const rateLimits = await request(CODEX_APP_SERVER_METHODS.accountRateLimitsRead);
    return parseCodexAppServerSnapshot(account, rateLimits);
  } finally {
    stdout.off('data', onData);
    for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server closed'));
    pending.clear();
  }
}
