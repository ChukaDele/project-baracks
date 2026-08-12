import { describe, expect, it } from 'vitest';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { cursorModelOption, cursorModelValue } from '../src/execution/cursor-acp-runtime.js';

function modelOption(): SessionConfigOption {
  return {
    id: 'cursor-model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'auto',
    options: [
      { value: 'auto', name: 'Auto' },
      { value: 'claude-4.1-opus', name: 'Claude 4.1 Opus' },
      { value: 'gpt-5.2', name: 'GPT-5.2' },
    ],
  };
}

describe('Cursor ACP model capability', () => {
  it('discovers the typed model selector and resolves its values', () => {
    const option = cursorModelOption([modelOption()]);
    expect(option?.id).toBe('cursor-model');
    expect(cursorModelValue(option!, 'GPT-5.2')).toEqual({
      value: 'gpt-5.2',
      name: 'GPT-5.2',
    });
  });

  it('reports no selector instead of inventing model-selection support', () => {
    expect(
      cursorModelOption([
        {
          id: 'thought-level',
          name: 'Thinking',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [{ value: 'high', name: 'High' }],
        },
      ]),
    ).toBeUndefined();
  });

  it('rejects an unavailable requested model rather than silently using auto', () => {
    expect(
      cursorModelValue(
        modelOption() as Extract<SessionConfigOption, { type: 'select' }>,
        'missing',
      ),
    ).toBeUndefined();
  });
});
