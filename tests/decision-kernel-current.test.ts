import { describe, expect, it } from 'vitest';
import {
  decisionKernelEnabled,
  redactSemanticEntry,
  runDecision,
  type DecisionAdapter,
  type DecisionQuestion,
} from '../src/intelligence/decision-kernel.js';

function answer(question: DecisionQuestion, selected: string, confidence = 0.95) {
  if (question.type !== 'choice') throw new Error('expected choice');
  return {
    type: 'choice' as const,
    choice: selected,
    confidence,
    probabilities: Object.fromEntries(
      Object.keys(question.criteria).map((key) => [key, key === selected ? confidence : 0.01]),
    ),
  };
}
describe('current-main decision kernel', () => {
  it('requires key plus explicit semantic-egress opt-in', () => {
    const key = process.env.TYPESAFE_API_KEY;
    const egress = process.env.MAJOR_SEMANTIC_EGRESS;
    try {
      process.env.TYPESAFE_API_KEY = 'test-key';
      delete process.env.MAJOR_SEMANTIC_EGRESS;
      expect(decisionKernelEnabled()).toBe(false);
      process.env.MAJOR_SEMANTIC_EGRESS = 'allow';
      expect(decisionKernelEnabled()).toBe(true);
    } finally {
      if (key === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = key;
      if (egress === undefined) delete process.env.MAJOR_SEMANTIC_EGRESS;
      else process.env.MAJOR_SEMANTIC_EGRESS = egress;
    }
  });

  it('deep-redacts semantic state', () => {
    const value = redactSemanticEntry({
      token: 'sk-abcdefghijklmnop',
      nested: { clientSecret: 'top-secret', note: 'safe' },
    });
    expect(JSON.stringify(value)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(value)).not.toContain('top-secret');
    expect(JSON.stringify(value)).toContain('[REDACTED]');
  });
  it('fails safely on malformed adapter output', async () => {
    const adapter: DecisionAdapter = {
      async evaluate() {
        return { answers: { result: { type: 'choice', choice: 'outside' } } };
      },
    };
    const result = await runDecision(
      {
        decision: 'malformed',
        state: { task: 'x' },
        questions: {
          result: { type: 'choice', instructions: 'Choose.', criteria: { yes: null, no: null } },
        },
      },
      { adapter, telemetry: false },
    );
    expect(result).toMatchObject({ available: false, reason: 'malformed' });
  });

  it('enforces a total timeout even when adapter ignores abort', async () => {
    const adapter: DecisionAdapter = { evaluate: () => new Promise(() => undefined) };
    const result = await runDecision(
      {
        decision: 'timeout',
        state: 'x',
        questions: {
          result: { type: 'choice', instructions: 'Choose.', criteria: { yes: null, no: null } },
        },
      },
      { adapter, timeoutMs: 50, telemetry: false },
    );
    expect(result).toMatchObject({ available: false, reason: 'timeout' });
  });
  it('redacts state before an injected semantic adapter sees it', async () => {
    let observed = '';
    const adapter: DecisionAdapter = {
      async evaluate(request) {
        observed = JSON.stringify(request.state);
        return { answers: { result: answer(request.questions.result!, 'yes') } };
      },
    };
    await runDecision(
      {
        decision: 'redaction',
        state: { apiKey: 'sk-abcdefghijklmnop', note: 'safe' },
        questions: {
          result: { type: 'choice', instructions: 'Choose.', criteria: { yes: null, no: null } },
        },
      },
      { adapter, telemetry: false },
    );
    expect(observed).toContain('[REDACTED]');
    expect(observed).not.toContain('abcdefghijklmnop');
  });
});
