export const DELIVERY_STATES = ['planned', 'built', 'validated', 'ready'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const WORK_CLASSES = ['small', 'substantive'] as const;
export type WorkClass = (typeof WORK_CLASSES)[number];

export const REVIEW_LEVELS = ['none', 'focused', 'independent'] as const;
export type ReviewLevel = (typeof REVIEW_LEVELS)[number];

export const PROOF_STATES = ['not_required', 'unproven', 'proven'] as const;
export type ProofState = (typeof PROOF_STATES)[number];

export interface SdlcIntent {
  outcome: string;
  acceptance: string[];
  plan?: string[];
  evidence?: string[];
}

export interface SdlcRisk {
  touchesAuthority?: boolean;
  touchesPersistence?: boolean;
  touchesSecurity?: boolean;
  externalEffect?: boolean;
  irreversible?: boolean;
  broadBlastRadius?: boolean;
}

export interface SdlcDecision {
  workClass: WorkClass;
  review: ReviewLevel;
  requiresCompactState: boolean;
  requiredState: (keyof SdlcIntent)[];
  reasons: string[];
}

const HIGH_CONSEQUENCE_RISKS: (keyof SdlcRisk)[] = [
  'touchesAuthority',
  'touchesSecurity',
  'irreversible',
  'broadBlastRadius',
];

/**
 * Choose the minimum SDLC ceremony justified by scope and consequence.
 * Callers describe facts; this function does not infer risk from prose.
 */
export function decideSdlc(input: {
  estimatedFiles: number;
  acceptancePaths: number;
  risk?: SdlcRisk;
}): SdlcDecision {
  if (!Number.isInteger(input.estimatedFiles) || input.estimatedFiles < 0) {
    throw new Error('estimatedFiles must be a non-negative integer');
  }
  if (!Number.isInteger(input.acceptancePaths) || input.acceptancePaths < 1) {
    throw new Error('acceptancePaths must be a positive integer');
  }
  const risk = input.risk ?? {};
  const activeRisks = Object.entries(risk)
    .filter(([, active]) => active)
    .map(([name]) => name as keyof SdlcRisk);
  const consequential = activeRisks.some((name) => HIGH_CONSEQUENCE_RISKS.includes(name));
  const substantive =
    input.estimatedFiles > 2 || input.acceptancePaths > 1 || activeRisks.length > 0;

  return {
    workClass: substantive ? 'substantive' : 'small',
    review: consequential ? 'independent' : substantive ? 'focused' : 'none',
    requiresCompactState: substantive,
    requiredState: substantive
      ? ['outcome', 'acceptance', 'plan', 'evidence']
      : ['outcome', 'acceptance'],
    reasons: [
      substantive ? 'scope or risk requires a resumable compact state' : 'bounded low-risk change',
      consequential
        ? 'consequence requires independent review'
        : substantive
          ? 'focused review is proportional to the change'
          : 'deterministic acceptance proof is sufficient',
    ],
  };
}

export function validateSdlcIntent(
  intent: SdlcIntent,
  decision: SdlcDecision,
): { ok: boolean; missing: string[] } {
  const present = (field: keyof SdlcIntent) => {
    const value = intent[field];
    return Array.isArray(value)
      ? value.some((item) => item.trim().length > 0)
      : typeof value === 'string' && value.trim().length > 0;
  };
  const missing = decision.requiredState.filter((field) => !present(field));
  return { ok: missing.length === 0, missing };
}

export interface DeliveryEvidence {
  implementationExists: boolean;
  deterministicChecksPassed: boolean;
  reviewPassed?: boolean;
  installationProven?: boolean;
  representativeBehaviorProven?: boolean;
}

export interface DeliveryAssessment {
  delivery: DeliveryState;
  reviewProof: ProofState;
  installationProof: ProofState;
  behaviorProof: Exclude<ProofState, 'not_required'>;
}

/**
 * Return truthful delivery and operational proof states. Review is required
 * only at the level selected by decideSdlc; installation is explicit because
 * a source-only change may not have an install step, while a Major release
 * does. READY always requires representative behavior proof.
 */
export function assessDelivery(
  evidence: DeliveryEvidence,
  requirements: { review: ReviewLevel; installationRequired: boolean },
): DeliveryAssessment {
  const reviewProof =
    requirements.review === 'none' ? 'not_required' : evidence.reviewPassed ? 'proven' : 'unproven';
  const installationProof = requirements.installationRequired
    ? evidence.installationProven
      ? 'proven'
      : 'unproven'
    : 'not_required';
  const behaviorProof = evidence.representativeBehaviorProven ? 'proven' : 'unproven';

  let delivery: DeliveryState = 'planned';
  if (evidence.implementationExists) {
    delivery = 'built';
    const reviewSatisfied = reviewProof === 'not_required' || reviewProof === 'proven';
    if (evidence.deterministicChecksPassed && reviewSatisfied) {
      delivery = 'validated';
      const installationSatisfied =
        installationProof === 'not_required' || installationProof === 'proven';
      if (installationSatisfied && behaviorProof === 'proven') delivery = 'ready';
    }
  }

  return { delivery, reviewProof, installationProof, behaviorProof };
}

export interface FailureRegression {
  regressionArtifact: {
    failure: string;
    reproduction: string;
    expected: string;
    verification: string;
  };
  learningCandidate?: {
    summary: string;
    evidence: string;
    scope: 'project';
  };
}

/**
 * Keep the executable/project-specific regression beside the project. A
 * separate, sanitized principle may enter the existing learning lifecycle.
 */
export function failureRegression(input: {
  failure: string;
  reproduction: string;
  expected: string;
  verification: string;
  generalisableLearning?: string;
}): FailureRegression {
  const regressionArtifact = {
    failure: input.failure.trim(),
    reproduction: input.reproduction.trim(),
    expected: input.expected.trim(),
    verification: input.verification.trim(),
  };
  const learning = input.generalisableLearning?.trim();
  return {
    regressionArtifact,
    ...(learning
      ? {
          learningCandidate: {
            summary: learning,
            evidence: `Regression: ${regressionArtifact.verification}`,
            scope: 'project' as const,
          },
        }
      : {}),
  };
}
