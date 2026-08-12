import { describe, expect, it } from 'vitest';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import {
  cursorModelOption,
  cursorModelValue,
  decideCursorPermission,
} from '../src/execution/cursor-acp-runtime.js';
import { providerActionDigest } from '../src/security/provider-approval-policy.js';

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

describe('Cursor ACP approval consumption', () => {
  it('allows an exact approved action once and denies its replay in the same session', () => {
    const action = { kind: 'execute' as const, rawInput: { command: 'pnpm test' } };
    const decisions = [
      {
        category: 'command_execution' as const,
        decisionId: 'decision-1',
        actionDigest: providerActionDigest(action),
      },
    ];
    const authority = { decisions };
    const remaining = [...decisions];
    expect(decideCursorPermission(action, authority, remaining).outcome).toBe('automatic');
    expect(remaining).toHaveLength(0);
    expect(decideCursorPermission(action, authority, remaining).outcome).toBe('approval_required');
  });
});
