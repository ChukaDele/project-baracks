import {
  DEFAULT_DECISION_CONFIDENCE,
  runDecision,
  type DecisionAdapter,
} from './decision-kernel.js';
import { redactText } from '../security/redact.js';

export const REPAIR_ACTIONS = [
  'accept',
  'targeted_fix',
  'change_strategy',
  'escalate',
  'stop',
] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

export interface RepairPolicyInput {
  semanticAction?: RepairAction | undefined;
  semanticConfidence?: number | undefined;
  failureCount: number;
  materiallyUnchangedFailures: number;
  hardFailureLimit?: number | undefined;
  independentReviewSatisfied?: boolean | undefined;
  workerSucceeded?: boolean | undefined;
}

export interface RepairPolicyDecision {
  action: RepairAction;
  reason: string;
}

/** Pure policy composition. Semantic output can select a bounded next posture,
 * but cannot turn a failed worker into success or satisfy independent review. */
export function composeRepairPolicy(input: RepairPolicyInput): RepairPolicyDecision {
  const hardLimit = input.hardFailureLimit ?? 6;
  if (input.failureCount >= hardLimit) {
    return { action: 'stop', reason: `hard failure limit reached (${hardLimit})` };
  }
  let action = input.semanticAction ?? 'targeted_fix';
  if (action === 'accept' && (!input.workerSucceeded || !input.independentReviewSatisfied)) {
    action = 'targeted_fix';
  }
  if ((action === 'stop' || action === 'escalate') && input.failureCount < 3) {
    action = input.materiallyUnchangedFailures >= 2 ? 'change_strategy' : 'targeted_fix';
  }
  if (
    input.materiallyUnchangedFailures >= 2 &&
    (action === 'accept' || action === 'targeted_fix')
  ) {
    action = 'change_strategy';
  }
  return {
    action,
    reason:
      input.materiallyUnchangedFailures >= 2 && action === 'change_strategy'
        ? 'two materially unchanged failures require a different strategy'
        : input.semanticAction
          ? 'bounded semantic repair judgment composed with hard policy'
          : 'deterministic targeted repair fallback',
  };
}

export function materiallySameFailure(current: string, previous?: string): boolean {
  const normalize = (value: string | undefined) =>
    (value ?? '')
      .toLowerCase()
      .replace(/[0-9a-f]{7,64}/g, '<id>')
      .replace(/\d+/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
  const left = normalize(current);
  const right = normalize(previous);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 80 && longer.includes(shorter.slice(0, Math.min(260, shorter.length)));
}

export async function judgeRepairAction(
  input: {
    task: string;
    failureSummary: string;
    failureCount: number;
    materiallyUnchangedFailures: number;
  },
  options: { adapter?: DecisionAdapter; confidence?: number; telemetry?: boolean } = {},
): Promise<{ decision: RepairPolicyDecision; usedSemanticJudgment: boolean }> {
  const result = await runDecision(
    {
      decision: 'result-repair-gate',
      state: {
        task: redactText(input.task),
        failure_summary: redactText(input.failureSummary).slice(0, 12_000),
        failure_count: input.failureCount,
        materially_unchanged_failures: input.materiallyUnchangedFailures,
      },
      questions: {
        action: {
          type: 'choice',
          instructions:
            'Choose the safest useful next posture. This judgment cannot mark work complete, grant permission, or satisfy independent review.',
          criteria: {
            accept:
              'The reported result is adequate, subject to deterministic completion and review gates.',
            targeted_fix: 'Keep the strategy and make one specific bounded correction.',
            change_strategy: 'Use a materially different tool, provider, or technical approach.',
            escalate: 'Stop autonomous repair and surface the issue to the controlling workflow.',
            stop: 'Further work is unsafe or predictably wasteful under current constraints.',
          },
        },
      },
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  const answer = result.available ? result.answers.action : undefined;
  const threshold = options.confidence ?? Math.max(DEFAULT_DECISION_CONFIDENCE, 0.82);
  const semanticAction =
    answer?.type === 'choice' &&
    REPAIR_ACTIONS.includes(answer.choice as RepairAction) &&
    answer.confidence >= threshold
      ? (answer.choice as RepairAction)
      : undefined;
  const semanticConfidence = answer?.type === 'choice' ? answer.confidence : undefined;
  return {
    decision: composeRepairPolicy({
      ...(semanticAction ? { semanticAction, semanticConfidence } : {}),
      failureCount: input.failureCount,
      materiallyUnchangedFailures: input.materiallyUnchangedFailures,
      workerSucceeded: false,
      independentReviewSatisfied: false,
    }),
    usedSemanticJudgment: Boolean(semanticAction),
  };
}
