import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  isTerminal,
  TASK_STATUSES,
  TransitionError,
  validateTransition,
} from '../src/domain/lifecycle.js';

describe('task lifecycle', () => {
  it('allows the happy path from suggested to completed', () => {
    const path = [
      ['suggested', 'draft'],
      ['draft', 'ready'],
      ['ready', 'queued'],
      ['queued', 'running'],
      ['running', 'verifying'],
      ['verifying', 'reviewing'],
      ['reviewing', 'ready_to_merge'],
      ['ready_to_merge', 'completed'],
    ] as const;
    for (const [from, to] of path) {
      expect(
        validateTransition(from, to, { incompleteDependencyCount: 0, evidenceCount: 1 }),
      ).toEqual({ ok: true });
    }
  });

  it('rejects illegal transitions', () => {
    expect(validateTransition('draft', 'running').ok).toBe(false);
    expect(validateTransition('completed', 'running').ok).toBe(false);
    expect(validateTransition('cancelled', 'ready').ok).toBe(false);
    expect(validateTransition('suggested', 'completed').ok).toBe(false);
  });

  it('supports the repair loop', () => {
    expect(validateTransition('verifying', 'repairing').ok).toBe(true);
    expect(validateTransition('repairing', 'verifying').ok).toBe(true);
    expect(validateTransition('reviewing', 'repairing').ok).toBe(true);
  });

  it('blocks ready -> queued while dependencies are incomplete', () => {
    const result = validateTransition('ready', 'queued', { incompleteDependencyCount: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/blocked by 2/);
  });

  it('refuses completion without evidence', () => {
    const result = validateTransition('ready_to_merge', 'completed', { evidenceCount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/without.*evidence/);
  });

  it('refuses guarded transitions when guard data was not supplied', () => {
    expect(validateTransition('ready', 'queued').ok).toBe(false);
    expect(validateTransition('ready_to_merge', 'completed').ok).toBe(false);
  });

  it('assertTransition throws a typed error', () => {
    expect(() => assertTransition('draft', 'running')).toThrow(TransitionError);
  });

  it('treats completed and cancelled as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(TASK_STATUSES.filter(isTerminal)).toEqual(['completed', 'cancelled']);
  });
});
