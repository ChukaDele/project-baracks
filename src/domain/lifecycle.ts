/**
 * Canonical task lifecycle. The task's status lives ONLY on the Task row;
 * every status change must pass through validateTransition/assertTransition.
 *
 * `suggested` is the conceptual entry state: it is represented by a
 * TaskSuggestion row, not a Task row. Approving a suggestion performs the
 * suggested -> draft transition and materialises the Task.
 */

export const TASK_STATUSES = [
  'suggested',
  'draft',
  'ready',
  'queued',
  'running',
  'verifying',
  'reviewing',
  'repairing',
  'needs_decision',
  'ready_to_merge',
  'completed',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  suggested: ['draft', 'cancelled'],
  draft: ['ready', 'cancelled'],
  ready: ['queued', 'draft', 'cancelled'],
  queued: ['running', 'ready', 'cancelled'],
  running: ['verifying', 'needs_decision', 'failed', 'cancelled'],
  verifying: ['reviewing', 'repairing', 'needs_decision', 'failed', 'cancelled'],
  reviewing: ['ready_to_merge', 'repairing', 'needs_decision', 'failed', 'cancelled'],
  repairing: ['verifying', 'needs_decision', 'failed', 'cancelled'],
  needs_decision: ['ready', 'queued', 'repairing', 'ready_to_merge', 'failed', 'cancelled'],
  ready_to_merge: ['completed', 'repairing', 'needs_decision', 'cancelled'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: [],
};

/** Guard data supplied by the service layer; the machine itself is pure. */
export interface TransitionGuards {
  /** Number of dependencies not yet completed. Required for ready -> queued. */
  incompleteDependencyCount?: number;
  /** Number of Evidence rows attached to the task. Required for -> completed. */
  evidenceCount?: number;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function validateTransition(
  from: TaskStatus,
  to: TaskStatus,
  guards: TransitionGuards = {},
): TransitionResult {
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `illegal transition: ${from} -> ${to}` };
  }
  if (from === 'ready' && to === 'queued') {
    const incomplete = guards.incompleteDependencyCount;
    if (incomplete === undefined) {
      return { ok: false, reason: 'ready -> queued requires dependency check' };
    }
    if (incomplete > 0) {
      return { ok: false, reason: `blocked by ${incomplete} incomplete dependency(ies)` };
    }
  }
  if (to === 'completed') {
    const evidence = guards.evidenceCount;
    if (evidence === undefined) {
      return { ok: false, reason: 'transition to completed requires evidence check' };
    }
    if (evidence < 1) {
      return { ok: false, reason: 'refusing to complete without at least one evidence record' };
    }
  }
  return { ok: true };
}

export class TransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
    reason: string,
  ) {
    super(reason);
    this.name = 'TransitionError';
  }
}

export function assertTransition(
  from: TaskStatus,
  to: TaskStatus,
  guards: TransitionGuards = {},
): void {
  const result = validateTransition(from, to, guards);
  if (!result.ok) throw new TransitionError(from, to, result.reason);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
