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
  const data = event.data as { usage?: unknown; msg?: { type?: string; info?: unknown } };
  return data.usage ?? (data.msg?.type === 'token_count' ? data.msg.info : undefined);
}
