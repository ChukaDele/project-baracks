import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { redactText } from '../security/redact.js';
import { observeReusableAssetCandidate, type AssetCandidateInput } from '../skills/assets.js';
import {
  observeSuccessfulWorkflow,
  recordSkillOutcome,
  type WorkflowObservation,
} from '../skills/lifecycle.js';
import {
  captureLearning,
  learningLockOwnerIsLive,
  learningRoot,
  type LearningCaptureInput,
} from './candidates.js';

/**
 * Fallback for every learning step: a step that fails (lock contention, I/O,
 * a bad store) is appended to <learningRoot>/queue.jsonl instead of failing
 * the run or the CLI, and is replayed at the next session start. Learning
 * never blocks delivery.
 */
export type LearningStep =
  | { kind: 'capture'; input: LearningCaptureInput }
  | { kind: 'workflow'; input: WorkflowObservation }
  | { kind: 'asset'; input: AssetCandidateInput }
  | { kind: 'skill-outcome'; input: Parameters<typeof recordSkillOutcome>[0] };

type QueuedStep = LearningStep & { attempts: number; queuedAt: string };

/** A step whose replay keeps failing moves to the dead-letter file for the digest. */
const MAX_ATTEMPTS = 5;
/** Learning steps are synchronous; the hard limit is the bounded store-lock
 * wait inside each step. A step that still overruns this is reported. */
export const LEARNING_STEP_BUDGET_MS = 5_000;

export function learningQueuePath(): string {
  return join(learningRoot(), 'queue.jsonl');
}

export function learningDeadLetterPath(): string {
  return join(learningRoot(), 'queue.failed.jsonl');
}

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)]));
  }
  return value;
}

function append(path: string, step: QueuedStep): void {
  mkdirSync(learningRoot(), { recursive: true });
  appendFileSync(path, `${JSON.stringify(redactDeep(step))}\n`, { mode: 0o600 });
}

export function enqueueLearningStep(step: LearningStep): void {
  append(learningQueuePath(), { ...step, attempts: 0, queuedAt: new Date().toISOString() });
}

function apply(step: LearningStep): void {
  switch (step.kind) {
    case 'capture':
      captureLearning(step.input);
      return;
    case 'workflow':
      observeSuccessfulWorkflow(step.input);
      return;
    case 'asset':
      observeReusableAssetCandidate(step.input);
      return;
    case 'skill-outcome':
      recordSkillOutcome(step.input);
      return;
  }
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Run one post-worker learning step. Never throws. Returns a warning to append
 * to the run summary, or undefined when the step succeeded within budget.
 */
export function runLearningStep(step: LearningStep): string | undefined {
  const started = Date.now();
  try {
    apply(step);
  } catch (error) {
    try {
      enqueueLearningStep(step);
      return ` ${step.kind} learning deferred to queue: ${message(error)}`;
    } catch (queueError) {
      return ` ${step.kind} learning lost (queue unavailable: ${message(queueError)}): ${message(error)}`;
    }
  }
  const elapsed = Date.now() - started;
  return elapsed > LEARNING_STEP_BUDGET_MS
    ? ` ${step.kind} learning took ${elapsed}ms (budget ${LEARNING_STEP_BUDGET_MS}ms).`
    : undefined;
}

/** Capture now, or queue on any failure (including store-lock contention). */
export function captureLearningOrQueue(
  input: LearningCaptureInput,
):
  | { queued: false; candidate: ReturnType<typeof captureLearning> }
  | { queued: true; reason: string } {
  try {
    return { queued: false, candidate: captureLearning(input) };
  } catch (error) {
    // Validation errors are the caller's mistake, not contention: surface them.
    if (/forbidden|must not be empty|learning key must|requires a project/.test(message(error))) {
      throw error;
    }
    enqueueLearningStep({ kind: 'capture', input });
    return { queued: true, reason: message(error) };
  }
}

/** Claim a queue file by atomic rename so two drains never replay one entry twice. */
function claim(path: string): string | undefined {
  const claimed = join(learningRoot(), `queue.${process.pid}.${randomUUID()}.draining`);
  try {
    renameSync(path, claimed);
    return claimed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export interface LearningQueueDrain {
  replayed: number;
  requeued: number;
  deadLettered: number;
}

/** Replay queued learning steps within a time budget. Leftovers stay queued. */
export function drainLearningQueue(budgetMs = 2_000): LearningQueueDrain {
  const result: LearningQueueDrain = { replayed: 0, requeued: 0, deadLettered: 0 };
  const root = learningRoot();
  if (!existsSync(root)) return result;
  const sources = readdirSync(root)
    .filter((name) => {
      const orphan = /^queue\.(\d+)\.[0-9a-f-]+\.draining$/.exec(name);
      return orphan ? !learningLockOwnerIsLive(Number(orphan[1])) : name === 'queue.jsonl';
    })
    .map((name) => join(root, name));
  const deadline = Date.now() + budgetMs;
  for (const source of sources) {
    const file = claim(source);
    if (!file) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let step: QueuedStep;
      try {
        step = JSON.parse(line) as QueuedStep;
      } catch {
        continue; // A torn line from a crashed append carries no recoverable step.
      }
      if (Date.now() < deadline) {
        try {
          apply(step);
          result.replayed += 1;
          continue;
        } catch {
          step = { ...step, attempts: step.attempts + 1 };
        }
      }
      if (step.attempts >= MAX_ATTEMPTS) {
        append(learningDeadLetterPath(), step);
        result.deadLettered += 1;
      } else {
        append(learningQueuePath(), step);
        result.requeued += 1;
      }
    }
    unlinkSync(file);
  }
  return result;
}

/** Number of queued and dead-lettered steps, for the digest. */
export function learningQueueDepth(): { queued: number; failed: number } {
  const count = (path: string) =>
    existsSync(path)
      ? readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line.trim()).length
      : 0;
  return { queued: count(learningQueuePath()), failed: count(learningDeadLetterPath()) };
}
