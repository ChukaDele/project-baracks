import { describe, expect, it } from 'vitest';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  parseProviderEventLine,
} from '../src/providers/evidence.js';

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
});
