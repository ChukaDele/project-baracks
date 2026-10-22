import { describe, expect, it } from 'vitest';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  normalizeProviderUsage,
  parseProviderEventLine,
} from '../src/providers/evidence.js';

// Recorded provider stdout (trimmed to the fields Major reads).
const CLAUDE_CODE_JSON = [
  '{"type":"system","subtype":"init","session_id":"c-1","model":"claude-opus-4-1"}',
  '{"type":"assistant","message":{"usage":{"input_tokens":4,"output_tokens":1}},"session_id":"c-1"}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"done","session_id":"c-1","total_cost_usd":0.0421,"usage":{"input_tokens":12,"cache_creation_input_tokens":3456,"cache_read_input_tokens":20480,"output_tokens":789,"server_tool_use":{"web_search_requests":0},"service_tier":"standard"}}',
];
const CODEX_EXEC_JSON = [
  '{"type":"thread.started","thread_id":"x-1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"done"}}',
  '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}',
];
const CODEX_TOKEN_COUNT = [
  '{"id":"0","msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5000,"cached_input_tokens":4000,"output_tokens":300,"reasoning_output_tokens":128,"total_tokens":5300},"last_token_usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12},"model_context_window":272000}}}',
];

/** Mirrors the gateway: the last event carrying usage wins. */
function capturedUsage(lines: string[]): unknown {
  let usage: unknown;
  for (const line of lines) {
    const next = extractProviderUsage(parseProviderEventLine(line)!);
    if (next !== undefined) usage = next;
  }
  return usage;
}

describe('provider execution evidence', () => {
  it('parses structured output and preserves provider-specific session references', () => {
    const claude = parseProviderEventLine('{"type":"result","session_id":"claude-session"}')!;
    const codex = parseProviderEventLine('{"type":"thread.started","thread_id":"codex-thread"}')!;
    const antigravity = parseProviderEventLine('{"conversation_id":"agy-conversation"}')!;
    expect(extractProviderSessionRef('claude', claude)).toBe('claude-session');
    expect(extractProviderSessionRef('codex', codex)).toBe('codex-thread');
    expect(extractProviderSessionRef('antigravity', antigravity)).toBe('agy-conversation');
  });

  it('distinguishes absent usage from a present provider usage payload', () => {
    expect(extractProviderUsage({ type: 'result', data: { usage: { input_tokens: 12 } } })).toEqual(
      {
        input_tokens: 12,
      },
    );
    expect(extractProviderUsage({ type: 'raw', data: 'plain text' })).toBeUndefined();
  });

  it('normalises recorded claude-code result usage including cost', () => {
    expect(normalizeProviderUsage(capturedUsage(CLAUDE_CODE_JSON))).toEqual({
      tokens: {
        input: 12,
        output: 789,
        cacheRead: 20480,
        cacheCreation: 3456,
        reasoning: null,
        total: 801,
      },
      cost: { cost: 0.0421, currency: 'USD' },
    });
  });

  it('normalises recorded codex exec and token_count usage', () => {
    expect(normalizeProviderUsage(capturedUsage(CODEX_EXEC_JSON))).toEqual({
      tokens: {
        input: 24763,
        output: 122,
        cacheRead: 24448,
        cacheCreation: null,
        reasoning: null,
        total: 24885,
      },
    });
    expect(normalizeProviderUsage(capturedUsage(CODEX_TOKEN_COUNT))).toEqual({
      tokens: {
        input: 5000,
        output: 300,
        cacheRead: 4000,
        cacheCreation: null,
        reasoning: 128,
        total: 5300,
      },
    });
    expect(normalizeProviderUsage(undefined)).toBeUndefined();
    expect(normalizeProviderUsage({ service_tier: 'standard' })).toBeUndefined();
  });
});
