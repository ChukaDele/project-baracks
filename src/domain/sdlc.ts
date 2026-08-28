export const DELIVERY_STATES = ['planned', 'built', 'validated', 'ready'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const WORK_CLASSES = ['small', 'substantive'] as const;
export type WorkClass = (typeof WORK_CLASSES)[number];

export const REVIEW_LEVELS = ['none', 'focused', 'independent'] as const;
export type ReviewLevel = (typeof REVIEW_LEVELS)[number];

export const REVIEW_SEVERITIES = ['BLOCKER', 'IMPORTANT', 'NIT'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const PROOF_STATES = ['not_required', 'unproven', 'proven'] as const;
export type ProofState = (typeof PROOF_STATES)[number];

export const DELIVERY_EVIDENCE_KINDS = [
  'IMPLEMENTED',
  'TESTED',
  'STAGED',
  'RESOLVED',
  'LOADED',
  'FOLLOWED',
  'INSTALLED',
  'BEHAVIOURALLY PROVEN',
] as const;
export type DeliveryEvidenceKind = (typeof DELIVERY_EVIDENCE_KINDS)[number];
export type DeliveryEvidenceMatrix = Record<DeliveryEvidenceKind, ProofState>;

export const VALIDATION_CHECKS = [
  'focused_tests',
  'cheapest_compile_type_or_build',
  'critical_path_behavior',
  'risk_specific_checks',
  'broader_validation',
] as const;
export type ValidationCheck = (typeof VALIDATION_CHECKS)[number];

export const BROADER_VALIDATION_TRIGGERS = [
  'blast_radius',
  'shared_dependency',
  'insufficient_evidence',
  'historical_regression',
  'promotion_policy',
] as const;
export type BroaderValidationTrigger = (typeof BROADER_VALIDATION_TRIGGERS)[number];

export const PROMOTION_STATES = ['NOT_PROMOTABLE', 'PROMOTABLE'] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export interface SdlcIntent {
  intent: string;
  spec: string[];
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
    requiredState: substantive ? ['intent', 'spec', 'plan', 'evidence'] : ['intent', 'spec'],
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

export type ReviewFindingDisposition = 'block' | 'triage' | 'advisory';

/** Classify review action without turning every evidenced issue into an MVP blocker. */
export function reviewFindingDisposition(input: {
  severity?: ReviewSeverity;
  speculative?: boolean;
}): ReviewFindingDisposition {
  if (input.speculative || input.severity === undefined || input.severity === 'NIT') {
    return 'advisory';
  }
  return input.severity === 'BLOCKER' ? 'block' : 'triage';
}

export function reviewFindingBlocksPromotion(input: {
  severity?: ReviewSeverity;
  speculative?: boolean;
}): boolean {
  return reviewFindingDisposition(input) === 'block';
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

/** Select the cheapest credible proof first and broaden only for explicit triggers. */
export function planProgressiveValidation(input: {
  riskSpecificChecks?: string[];
  triggers?: Partial<Record<BroaderValidationTrigger, boolean>>;
}): {
  requiredChecks: ValidationCheck[];
  broaderValidationRequired: boolean;
  activeTriggers: BroaderValidationTrigger[];
} {
  const activeTriggers = BROADER_VALIDATION_TRIGGERS.filter((trigger) => input.triggers?.[trigger]);
  const requiredChecks: ValidationCheck[] = [
    'focused_tests',
    'cheapest_compile_type_or_build',
    'critical_path_behavior',
  ];
  if (input.riskSpecificChecks?.some((check) => check.trim().length > 0)) {
    requiredChecks.push('risk_specific_checks');
  }
  if (activeTriggers.length > 0) requiredChecks.push('broader_validation');
  return {
    requiredChecks,
    broaderValidationRequired: activeTriggers.length > 0,
    activeTriggers,
  };
}

/**
 * Decide whether a validated candidate may enter merge/install. Installation
 * is deliberately absent: installed behavior is post-promotion READY proof.
 */
export function assessPromotion(input: {
  prePromotionEvidencePassed: boolean;
  review: ReviewLevel;
  reviewPassed?: boolean;
  blockerFindings: number;
}): { promotion: PromotionState; blockers: string[] } {
  if (!Number.isInteger(input.blockerFindings) || input.blockerFindings < 0) {
    throw new Error('blockerFindings must be a non-negative integer');
  }
  const blockers: string[] = [];
  if (!input.prePromotionEvidencePassed)
    blockers.push('required pre-promotion evidence is missing');
  if (input.review !== 'none' && !input.reviewPassed)
    blockers.push('required review has not passed');
  if (input.blockerFindings > 0) blockers.push('BLOCKER findings remain');
  return { promotion: blockers.length === 0 ? 'PROMOTABLE' : 'NOT_PROMOTABLE', blockers };
}

/**
 * Resolve task-appropriate delivery evidence without turning every possible
 * proof into a universal gate. Applicable states need at least one non-empty
 * evidence record; every other state is explicitly not required.
 */
export function assessTaskDeliveryEvidence(input: {
  applicable: DeliveryEvidenceKind[];
  evidence?: Partial<Record<DeliveryEvidenceKind, string[]>>;
}): DeliveryEvidenceMatrix {
  const applicable = new Set(input.applicable);
  return Object.fromEntries(
    DELIVERY_EVIDENCE_KINDS.map((kind) => {
      if (!applicable.has(kind)) return [kind, 'not_required'];
      const proven = input.evidence?.[kind]?.some((item) => item.trim().length > 0) ?? false;
      return [kind, proven ? 'proven' : 'unproven'];
    }),
  ) as DeliveryEvidenceMatrix;
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
