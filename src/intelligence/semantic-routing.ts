import type { RunPurpose, TaskComplexity } from '../db/schema.js';
import type { RiskLevel } from '../routing/router.js';
import { redactText } from '../security/redact.js';
import {
  DEFAULT_DECISION_CONFIDENCE,
  runDecision,
  type DecisionAdapter,
  type DecisionAnswer,
} from './decision-kernel.js';

export const FALLBACK_ROUTING_CLASSIFICATION: {
  purpose: RunPurpose;
  complexity: TaskComplexity;
  riskLevel: RiskLevel;
} = {
  purpose: 'analysis',
  complexity: 'architectural',
  riskLevel: 'normal',
};

export interface SemanticRoutingClassification {
  purpose: RunPurpose;
  complexity: TaskComplexity;
  riskLevel: RiskLevel;
  usedSemanticClassification: boolean;
}

const purposeCriteria = {
  implementation: 'Create or change working code, configuration, or artifacts.',
  verification: 'Run checks and gather direct evidence that existing work behaves correctly.',
  review: 'Independently assess work produced by another provider or author.',
  repair: 'Diagnose and fix a known failure or regression.',
  analysis: 'Investigate, plan, explain, or make an architectural decision.',
} as const;

const complexityCriteria = {
  routine: 'Mechanical, localized, and well understood.',
  bounded: 'A contained change with a small number of known components.',
  complex: 'Multiple interacting components or substantial ambiguity.',
  architectural: 'Cross-cutting design, control-plane, security, or system-wide behavior.',
} as const;

const riskCriteria = {
  normal: 'Local and reversible work without sensitive authority.',
  high: 'Production, external-write, destructive, migration, or consequential operational work.',
  security_sensitive:
    'Authentication, credentials, permissions, vulnerabilities, cryptography, or security controls.',
} as const;

function confidentChoice<T extends string>(
  answer: DecisionAnswer | undefined,
  allowed: ReadonlySet<string>,
  fallback: T,
  threshold: number,
): T {
  return answer?.type === 'choice' && allowed.has(answer.choice) && answer.confidence >= threshold
    ? (answer.choice as T)
    : fallback;
}

function deterministicPurpose(task: string): RunPurpose | undefined {
  if (
    /\b(?:independent review|code review|review this|audit this|red[- ]team|review the implementation)\b/i.test(
      task,
    )
  ) {
    return 'review';
  }
  if (/\b(?:verify|validate|verification|qa check|test only|inspect only)\b/i.test(task)) {
    return 'verification';
  }
  return undefined;
}

function deterministicRisk(task: string): RiskLevel {
  if (
    /\b(?:security|credential|secret|token|password|authentication|authorization|permission|vulnerab|exploit|cryptograph|encryption|sandbox|trust boundary)\b/i.test(
      task,
    )
  ) {
    return 'security_sensitive';
  }
  if (
    /\b(?:production|deploy|release|delete|destroy|drop|truncate|migrate|external write|irreversible|billing|payment|dns)\b/i.test(
      task,
    )
  ) {
    return 'high';
  }
  return 'normal';
}

function maxRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = { normal: 0, high: 1, security_sensitive: 2 };
  return rank[left] >= rank[right] ? left : right;
}

export async function classifyRoutingRequest(
  task: string,
  options: { adapter?: DecisionAdapter; confidence?: number; telemetry?: boolean } = {},
): Promise<SemanticRoutingClassification> {
  const deterministic = deterministicRisk(task);
  const explicitPurpose = deterministicPurpose(task);
  const result = await runDecision(
    {
      decision: 'agent-model-routing',
      state: { task: redactText(task) },
      questions: {
        purpose: {
          type: 'choice',
          instructions: 'What is the primary execution purpose of this task?',
          criteria: purposeCriteria,
        },
        complexity: {
          type: 'choice',
          instructions: 'What is the minimum honest complexity class for this task?',
          criteria: complexityCriteria,
        },
        risk: {
          type: 'choice',
          instructions: 'What is the risk class of carrying out this task?',
          criteria: riskCriteria,
        },
      },
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  if (!result.available) {
    return { ...FALLBACK_ROUTING_CLASSIFICATION, usedSemanticClassification: false };
  }
  const threshold = options.confidence ?? DEFAULT_DECISION_CONFIDENCE;
  const semanticRisk = confidentChoice<RiskLevel>(
    result.answers.risk,
    new Set(Object.keys(riskCriteria)),
    'normal',
    threshold,
  );
  return {
    purpose:
      explicitPurpose ??
      confidentChoice<RunPurpose>(
        result.answers.purpose,
        new Set(Object.keys(purposeCriteria)),
        FALLBACK_ROUTING_CLASSIFICATION.purpose,
        threshold,
      ),
    complexity: confidentChoice<TaskComplexity>(
      result.answers.complexity,
      new Set(Object.keys(complexityCriteria)),
      FALLBACK_ROUTING_CLASSIFICATION.complexity,
      threshold,
    ),
    riskLevel: maxRisk(deterministic, semanticRisk),
    usedSemanticClassification: true,
  };
}
