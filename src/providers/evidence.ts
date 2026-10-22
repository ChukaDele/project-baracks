import type { ProviderEvent } from './types.js';
import type { ProviderCommandHost } from './commands.js';

export function parseProviderEventLine(line: string): ProviderEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const data = JSON.parse(trimmed) as { type?: string };
    return { type: data.type ?? 'message', data };
  } catch {
    return { type: 'raw', data: trimmed };
  }
}

export function extractProviderSessionRef(
  host: ProviderCommandHost,
  event: ProviderEvent,
): string | undefined {
  if (!event.data || typeof event.data !== 'object') return undefined;
  const data = event.data as {
    session_id?: string;
    thread_id?: string;
    conversation_id?: string;
    msg?: { session_id?: string };
  };
  if (host === 'claude') return data.session_id;
  if (host === 'codex') return data.session_id ?? data.thread_id ?? data.msg?.session_id;
  if (host === 'antigravity') return data.conversation_id ?? data.session_id;
  return undefined;
}

export function extractProviderUsage(event: ProviderEvent): unknown {
  if (!event.data || typeof event.data !== 'object') return undefined;
  const data = event.data as {
    usage?: unknown;
    total_cost_usd?: unknown;
    msg?: { type?: string; info?: unknown };
  };
  // Claude reports cost beside, not inside, the result usage object.
  if (data.usage && typeof data.usage === 'object' && typeof data.total_cost_usd === 'number') {
    return { ...data.usage, total_cost_usd: data.total_cost_usd };
  }
  return data.usage ?? (data.msg?.type === 'token_count' ? data.msg.info : undefined);
}

export interface NormalizedProviderUsage {
  /** Keys deliberately avoid the word "token" so redactValue keeps the counts. */
  tokens?: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheCreation: number | null;
    reasoning: number | null;
    total: number | null;
  };
  cost?: { cost: number; currency: 'USD' };
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Normalises the raw usage payload captured by extractProviderUsage: Claude
 * result `usage` (+ total_cost_usd), Codex `turn.completed` usage, or the
 * Codex token_count `info` (cumulative total_token_usage).
 */
export function normalizeProviderUsage(raw: unknown): NormalizedProviderUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const outer = raw as Record<string, unknown>;
  const u = (
    outer.total_token_usage && typeof outer.total_token_usage === 'object'
      ? outer.total_token_usage
      : outer
  ) as Record<string, unknown>;
  const input = count(u.input_tokens);
  const output = count(u.output_tokens);
  const result: NormalizedProviderUsage = {};
  if (input !== null || output !== null) {
    result.tokens = {
      input,
      output,
      cacheRead: count(u.cache_read_input_tokens) ?? count(u.cached_input_tokens),
      cacheCreation: count(u.cache_creation_input_tokens),
      reasoning: count(u.reasoning_output_tokens),
      total: count(u.total_tokens) ?? (input !== null && output !== null ? input + output : null),
    };
  }
  const cost = count(outer.total_cost_usd);
  if (cost !== null) result.cost = { cost, currency: 'USD' };
  return result.tokens || result.cost ? result : undefined;
}
