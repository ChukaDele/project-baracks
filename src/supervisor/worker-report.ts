import { redactText } from '../security/redact.js';
import { decideSdlc, type SdlcRisk } from '../domain/sdlc.js';
import {
  parseWritingGateEvidence,
  parseWritingSourcePacket,
  type WritingGateEvidence,
} from '../writing/runtime.js';
import type { WritingSourcePacket } from '../writing/types.js';

const WORKER_REPORT_PREFIX = 'MAJOR_RESULT: ';
const FINAL_REPORT_TYPE = 'major.result.final';
const AMBIGUOUS_REPORT_TYPE = 'major.result.ambiguous';
export const AMBIGUOUS_WORKER_REPORT_ENVELOPE = JSON.stringify({
  type: AMBIGUOUS_REPORT_TYPE,
});

export interface PrePromotionEvidence {
  focusedTests: string;
  cheapestCompileTypeOrBuild: string;
  criticalPathBehavior: string;
  materialRiskChecks: { criterion: string; evidence: string }[];
  broaderValidation: {
    triggers: (
      | 'blast_radius'
      | 'shared_dependency'
      | 'insufficient_evidence'
      | 'historical_regression'
      | 'promotion_policy'
    )[];
    repositoryPolicyRequires: boolean;
    performed: boolean;
    cost?: string;
    expectedInformationGain?: string;
    evidence?: string;
  };
  review: { level: 'none' | 'focused' | 'independent'; passed: boolean };
  blockerFindings: number;
}

export interface SupervisorPromotionContract {
  review: 'none' | 'focused' | 'independent';
  materialRiskCriteria: string[];
  broaderValidationTriggers: PrePromotionEvidence['broaderValidation']['triggers'];
  repositoryPolicyRequiresBroadValidation: boolean;
}

export interface SupervisorAdmissionRiskAssessment {
  source: 'major_outcome_policy_v1';
  classification: 'bounded' | 'substantive' | 'high_consequence' | 'unavailable';
  estimatedFiles: number;
  acceptancePaths: number;
  risk: SdlcRisk;
  materialRiskCriteria: string[];
}

export interface AdmissionProjectPolicyFacts {
  projectClass: 'unknown' | 'workshop' | 'client' | 'knowledge';
  trust: 'observe' | 'assist' | 'build' | 'unattended';
  allowExternalWrites: boolean;
  allowPaidSpend: boolean;
}

export const DEFAULT_SUPERVISOR_PROMOTION_CONTRACT: SupervisorPromotionContract = {
  review: 'focused',
  materialRiskCriteria: [],
  broaderValidationTriggers: [],
  repositoryPolicyRequiresBroadValidation: false,
};

/** Split camelCase and treat `_`/`-` as spaces, so operation ids
 * (`completion_policy`, `deleteUser`, `git-push`) match like prose. */
const riskText = (fact: string): string =>
  fact
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // `CSRFToken` -> `CSRF Token`, but `OAuth2`/`PRs`/`IDs`/`JWTs` stay whole.
    .replace(/([A-Z]{2,})([A-Z][a-z]{2})/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

/** Whole-word match on riskText, so incidental substrings (`preview`,
 * `dropdown`, `tokenizer`) do not fire. */
const words = (alternatives: string): RegExp => new RegExp(`\\b(?:${alternatives})\\b`, 'i');

/** Up to two filler words between a verb and its object ("drop the users table"). */
const GAP = '(?:\\w+ ){0,2}';

// Generic words (session, role, push, shared, drop, review) are only risky in
// a qualified form; alone they fire on ordinary UI and tooling goals. When in
// doubt, match: under-classifying security or authority weakens review depth.
const RISK_CRITERIA: readonly [keyof SdlcRisk, RegExp, string][] = [
  [
    'touchesAuthority',
    words(
      'authorit(?:y|ies)|permissions?|polic(?:y|ies)|promot(?:e|es|ed|ing|ion|ions)|completion|' +
        'reviewers?|(?:independent|required|mandatory|code|pr|adversarial) reviews?|' +
        'reviews? (?:gate|policy|depth|requirements?|approvals?)|' +
        `(?:bypass|skip|require|request|need)\\w* ${GAP}reviews?|review ${GAP}(?:pr|pull request|diff)s?`,
    ),
    'authority',
  ],
  [
    'touchesPersistence',
    words('databases?|db|sqlite|postgres\\w*|schemas?|migrat\\w*|persist\\w*|storage'),
    'persistence',
  ],
  [
    'touchesSecurity',
    words(
      'security|secrets?|credentials?|passwords?|auth|authn|authz|(?:un)?authenticat\\w*|(?:un)?authori[sz]\\w*|' +
        'log ?(?:in|ins|ged in)|sign(?:s|ed|ing)? ?(?:in|on)|sso|access ?controls?|rls|' +
        'identit(?:y|ies)|oauth\\w*|mfa|2fa|rbac|privileges?|(?:en|de)crypt\\w*|privacy|pii|jwts?|csrf|api ?keys?|signatures?|sign(?:ing|ed)? (?:urls?|requests?|keys?)|(?:urls?|requests?) sign(?:ing|ed|atures?)?|' +
        // ponytail: design tokens and token budget/usage are UI or LLM cost, not security; extend the exclusion list if more cost terms appear.
        '(?<!design )tokens?(?! (?:budgets?|usage|counts?|limits?|diet|costs?|spend))|' +
        'sessions? (?:tokens?|cookies?|fixation|hijack\\w*|expir\\w*|revo[ck]\\w*|timeouts?|security|management|ids?|keys?|secrets?)|' +
        `(?:invalidat|expir|revok|terminat|hijack|rotat)\\w* ${GAP}sessions?|` +
        'roles? (?:based|assignments?|permissions?|checks?|guards?|hierarch\\w*|escalation)|' +
        `(?:assign|grant|revok|check|elevat|chang|remov)\\w* ${GAP}roles?|(?:user|admin|member|owner) roles?`,
    ),
    'security',
  ],
  [
    'externalEffect',
    words(
      'deploy\\w*|publish\\w*|(?:auto ?)?merg(?:e|es|ed|ing)|external ?writes?|' +
        '(?:git|force) push\\w*|push\\w* (?:\\w+ )?(?:force|f)|' +
        `push\\w* ${GAP}to (?:main|master|prod\\w*|origin|remote|github|upstream)`,
    ),
    'external effect',
  ],
  [
    'irreversible',
    words(
      'irreversibl\\w*|destructive|delet(?:e|es|ed|ing|ion|ions)|truncat\\w*|wip(?:e|es|ed|ing)|purg(?:e|es|ed|ing)|' +
        'rm rf|reset hard|' +
        `drop\\w* ${GAP}(?:tables?|columns?|databases?|index(?:es)?|schemas?|data|users?|records?|rows?)`,
    ),
    'irreversibility',
  ],
  [
    'broadBlastRadius',
    words(
      'global(?:ly)?|installers?|broad|' +
        'shared (?:\\w+ )?(?:state|memory|dependency|dependencies|librar(?:y|ies)|config\\w*|database|infra\\w*|runtime)|' +
        '(?:supervisor|major|production) runtime',
    ),
    'blast radius',
  ],
];

const SUBSTANTIVE_OUTCOME =
  /\b(build|repair|ship|release|redesign|migrat\w*|integrat\w*|end[- ]to[- ]end|architecture|workflow|runtime|system)\b/i;

/** Major-owned deterministic admission classification. It reads only the
 * admitted objective, durable routing operations, and project policy. */
export function assessSupervisorAdmissionRisk(input: {
  outcome: string;
  requiredOperations?: readonly string[] | undefined;
  policy?: AdmissionProjectPolicyFacts | undefined;
}): SupervisorAdmissionRiskAssessment {
  const outcome = input.outcome.trim();
  const operations = [...new Set(input.requiredOperations ?? [])];
  if (!outcome || !input.policy || input.policy.projectClass === 'unknown') {
    return {
      source: 'major_outcome_policy_v1',
      classification: 'unavailable',
      estimatedFiles: 3,
      acceptancePaths: 2,
      risk: { touchesAuthority: true, broadBlastRadius: true },
      materialRiskCriteria: ['authority', 'blast radius'],
    };
  }
  const facts = [outcome, ...operations].map(riskText);
  const risk: SdlcRisk = {};
  const materialRiskCriteria: string[] = [];
  for (const [field, pattern, criterion] of RISK_CRITERIA) {
    if (facts.some((fact) => pattern.test(fact))) {
      risk[field] = true;
      materialRiskCriteria.push(criterion);
    }
  }
  if (input.policy.trust === 'unattended') {
    risk.touchesAuthority = true;
    if (!materialRiskCriteria.includes('authority')) materialRiskCriteria.push('authority');
  }
  if (input.policy.projectClass === 'client') {
    risk.touchesSecurity = true;
    if (!materialRiskCriteria.includes('security')) materialRiskCriteria.push('security');
  }
  const highConsequence = Object.values(risk).some(Boolean);
  const substantive =
    SUBSTANTIVE_OUTCOME.test(outcome) || outcome.split(/\s+/).length >= 8 || operations.length >= 2;
  return {
    source: 'major_outcome_policy_v1',
    classification: highConsequence ? 'high_consequence' : substantive ? 'substantive' : 'bounded',
    estimatedFiles: substantive || highConsequence ? 3 : 1,
    acceptancePaths: substantive || highConsequence ? 2 : 1,
    risk,
    materialRiskCriteria,
  };
}

/** Freeze no-task completion requirements from Major-owned routing facts.
 * Worker prose and the completing report are deliberately absent. */
export function deriveSupervisorPromotionContract(input: {
  admissionRiskAssessment?: SupervisorAdmissionRiskAssessment | undefined;
  requiredOperations?: readonly string[] | undefined;
  autonomous: boolean;
}): SupervisorPromotionContract {
  const assessment =
    input.admissionRiskAssessment ??
    assessSupervisorAdmissionRisk({
      outcome: '',
      requiredOperations: input.requiredOperations,
    });
  const { risk, materialRiskCriteria } = assessment;
  const decision = decideSdlc({
    estimatedFiles: assessment.estimatedFiles,
    acceptancePaths: assessment.acceptancePaths,
    risk,
  });
  return {
    review: decision.review,
    materialRiskCriteria,
    broaderValidationTriggers: risk.broadBlastRadius ? ['blast_radius'] : [],
    repositoryPolicyRequiresBroadValidation: false,
  };
}

export interface WorkerReport {
  status: 'active' | 'blocked' | 'done';
  summary: string;
  /** Canonical task whose durable evidence supports a done claim. */
  taskId?: string;
  /** Structured PROMOTABLE claim for normal supervisor goals without tasks. */
  promotionEvidence?: PrePromotionEvidence;
  /** Provider-owned verdict emitted by a dedicated completion-review run. */
  independentReview?: {
    purpose: 'independent_completion_review';
    goalId: string;
    sourceHead: string;
    verdict: 'pass' | 'fail';
    evidence: string;
  };
  ownerGate?: string;
  learning?: {
    source: 'user-correction' | 'recurring-failure' | 'successful-procedure' | 'manual';
    summary: string;
    key?: string;
    evidence?: string;
  };
  workflow?: {
    task: string;
    outcome: string;
    steps: string[];
    tools: string[];
    validations: string[];
    scope: 'project' | 'global';
  };
  assetCandidate?: {
    id: string;
    kind: string;
    summary: string;
    locator: string;
    tags: string[];
    scope: 'shared' | 'project-local';
  };
  capabilityUse?: { key: string; evidence: string }[];
  /** Sole production draft input for canonical writing completion. */
  writingDraft?: string;
  writingSourcePacket?: WritingSourcePacket;
  writingEvidence?: WritingGateEvidence;
}

export function completedWorkflow(
  report: WorkerReport | undefined,
): WorkerReport['workflow'] | undefined {
  return report?.status === 'done' ? report.workflow : undefined;
}

function reportLinesFromText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(WORKER_REPORT_PREFIX));
}

function reportLinesFromEnvelope(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const event = value as Record<string, unknown>;
  if (event.type === 'result') return reportLinesFromText(event.result);
  if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    return item.type === 'agent_message' ? reportLinesFromText(item.text) : [];
  }
  if (event.type !== 'assistant' || !event.message || typeof event.message !== 'object') {
    return [];
  }
  const content = (event.message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const reports: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type !== undefined && candidate.type !== 'text') continue;
    reports.push(...reportLinesFromText(candidate.text));
  }
  return reports;
}

/** Preserve only the final provider-owned report from a complete event. This
 * keeps completion authority available even when the general output tail is
 * truncated, without retaining unbounded model output. */
export function preserveWorkerReportEnvelope(raw: string): string | undefined {
  try {
    const reports = reportLinesFromEnvelope(JSON.parse(raw));
    if (reports.length === 0) return undefined;
    if (reports.length !== 1) return AMBIGUOUS_WORKER_REPORT_ENVELOPE;
    return JSON.stringify({ type: FINAL_REPORT_TYPE, result: reports[0] });
  } catch {
    return undefined;
  }
}

/** Only known provider-owned assistant/result fields carry completion
 * authority. Bare stdout, tool output, and user-message payloads are ignored. */
export function parseWorkerReport(output: string): WorkerReport | undefined {
  const providerLines: string[] = [];
  const finalLines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const candidate = rawLine.trim();
    if (!candidate) continue;
    try {
      const event = JSON.parse(candidate) as Record<string, unknown>;
      if (event.type === AMBIGUOUS_REPORT_TYPE) return undefined;
      if (event.type === FINAL_REPORT_TYPE) {
        finalLines.push(...reportLinesFromText(event.result));
      } else {
        providerLines.push(...reportLinesFromEnvelope(event));
      }
    } catch {
      // Bare stdout is never completion authority.
    }
  }
  const eligible = finalLines.length > 0 ? finalLines : providerLines;
  if (eligible.length !== 1) return undefined;
  const line = eligible[0]!;
  try {
    const value = JSON.parse(line.slice(WORKER_REPORT_PREFIX.length)) as Record<string, unknown>;
    if (!['active', 'blocked', 'done'].includes(String(value.status))) return undefined;
    if (typeof value.summary !== 'string' || value.summary.trim().length === 0) return undefined;
    const summary = redactText(value.summary.trim()).slice(0, 12_000);
    const writingDraft = typeof value.writingDraft === 'string' ? value.writingDraft : undefined;
    if (
      value.writingDraft !== undefined &&
      (!writingDraft?.trim() || Buffer.byteLength(writingDraft, 'utf8') > 100_000)
    )
      return undefined;
    const taskId = typeof value.taskId === 'string' ? value.taskId.trim() : '';
    if (value.taskId !== undefined && !/^[a-z][a-z0-9_-]{2,127}$/.test(taskId)) return undefined;
    const writingSourcePacket =
      value.writingSourcePacket === undefined
        ? undefined
        : parseWritingSourcePacket(value.writingSourcePacket);
    if (value.writingSourcePacket !== undefined && !writingSourcePacket) return undefined;
    const writingEvidence =
      value.writingEvidence === undefined
        ? undefined
        : parseWritingGateEvidence(value.writingEvidence);
    if (value.writingEvidence !== undefined && !writingEvidence) return undefined;
    let promotionEvidence: PrePromotionEvidence | undefined;
    if (value.promotionEvidence !== undefined) {
      const candidate = value.promotionEvidence;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
      const record = candidate as Record<string, unknown>;
      const textField = (name: string) =>
        typeof record[name] === 'string' ? redactText(record[name].trim()).slice(0, 4_000) : '';
      const materialRiskChecks = Array.isArray(record.materialRiskChecks)
        ? record.materialRiskChecks
            .map((item) => {
              if (typeof item === 'string') {
                const legacy = redactText(item.trim()).slice(0, 2_000);
                return legacy ? { criterion: `legacy:${legacy}`, evidence: legacy } : undefined;
              }
              if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
              const proof = item as Record<string, unknown>;
              if (
                typeof proof.criterion !== 'string' ||
                !proof.criterion.trim() ||
                typeof proof.evidence !== 'string' ||
                !proof.evidence.trim()
              )
                return undefined;
              return {
                criterion: redactText(proof.criterion.trim()).slice(0, 500),
                evidence: redactText(proof.evidence.trim()).slice(0, 2_000),
              };
            })
            .filter((item): item is { criterion: string; evidence: string } => Boolean(item))
            .slice(0, 24)
        : undefined;
      if (
        !Array.isArray(record.materialRiskChecks) ||
        record.materialRiskChecks.length > 24 ||
        materialRiskChecks?.length !== record.materialRiskChecks.length
      )
        return undefined;
      const broad = record.broaderValidation;
      const review = record.review;
      if (
        !textField('focusedTests') ||
        !textField('cheapestCompileTypeOrBuild') ||
        !textField('criticalPathBehavior') ||
        !materialRiskChecks ||
        !broad ||
        typeof broad !== 'object' ||
        Array.isArray(broad) ||
        !review ||
        typeof review !== 'object' ||
        Array.isArray(review) ||
        !Number.isInteger(record.blockerFindings) ||
        Number(record.blockerFindings) < 0
      )
        return undefined;
      const broadRecord = broad as Record<string, unknown>;
      const triggers = Array.isArray(broadRecord.triggers) ? broadRecord.triggers : undefined;
      const allowedTriggers = [
        'blast_radius',
        'shared_dependency',
        'insufficient_evidence',
        'historical_regression',
        'promotion_policy',
      ] as const;
      const reviewRecord = review as Record<string, unknown>;
      if (
        !triggers ||
        triggers.some((trigger) => !allowedTriggers.includes(trigger as never)) ||
        typeof broadRecord.repositoryPolicyRequires !== 'boolean' ||
        typeof broadRecord.performed !== 'boolean' ||
        !['none', 'focused', 'independent'].includes(String(reviewRecord.level)) ||
        typeof reviewRecord.passed !== 'boolean'
      )
        return undefined;
      const optionalText = (name: string) =>
        typeof broadRecord[name] === 'string'
          ? redactText(broadRecord[name].trim()).slice(0, 4_000)
          : undefined;
      const cost = optionalText('cost');
      const expectedInformationGain = optionalText('expectedInformationGain');
      const broadEvidence = optionalText('evidence');
      promotionEvidence = {
        focusedTests: textField('focusedTests'),
        cheapestCompileTypeOrBuild: textField('cheapestCompileTypeOrBuild'),
        criticalPathBehavior: textField('criticalPathBehavior'),
        materialRiskChecks,
        broaderValidation: {
          triggers: [...new Set(triggers)] as PrePromotionEvidence['broaderValidation']['triggers'],
          repositoryPolicyRequires: broadRecord.repositoryPolicyRequires,
          performed: broadRecord.performed,
          ...(cost ? { cost } : {}),
          ...(expectedInformationGain ? { expectedInformationGain } : {}),
          ...(broadEvidence ? { evidence: broadEvidence } : {}),
        },
        review: {
          level: reviewRecord.level as PrePromotionEvidence['review']['level'],
          passed: reviewRecord.passed,
        },
        blockerFindings: Number(record.blockerFindings),
      };
    }
    let independentReview: WorkerReport['independentReview'];
    if (value.independentReview !== undefined) {
      const candidate = value.independentReview;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
      const review = candidate as Record<string, unknown>;
      if (
        review.purpose !== 'independent_completion_review' ||
        typeof review.goalId !== 'string' ||
        !review.goalId.trim() ||
        typeof review.sourceHead !== 'string' ||
        !/^[0-9a-f]{40}$/.test(review.sourceHead) ||
        !['pass', 'fail'].includes(String(review.verdict)) ||
        typeof review.evidence !== 'string' ||
        !review.evidence.trim() ||
        Buffer.byteLength(review.evidence, 'utf8') > 4_000
      )
        return undefined;
      independentReview = {
        purpose: 'independent_completion_review',
        goalId: review.goalId.trim(),
        sourceHead: review.sourceHead,
        verdict: review.verdict as 'pass' | 'fail',
        evidence: redactText(review.evidence.trim()),
      };
    }
    const ownerGate =
      typeof value.ownerGate === 'string' ? redactText(value.ownerGate.trim()).slice(0, 4_000) : '';
    if (value.status === 'blocked' && !ownerGate) return undefined;
    let learning: WorkerReport['learning'];
    if (value.learning !== undefined) {
      if (!value.learning || typeof value.learning !== 'object' || Array.isArray(value.learning)) {
        return undefined;
      }
      const candidate = value.learning as Record<string, unknown>;
      const sources = [
        'user-correction',
        'recurring-failure',
        'successful-procedure',
        'manual',
      ] as const;
      if (!sources.includes(candidate.source as (typeof sources)[number])) return undefined;
      if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
        return undefined;
      }
      learning = {
        source: candidate.source as NonNullable<WorkerReport['learning']>['source'],
        summary: redactText(candidate.summary.trim()).slice(0, 4_000),
        ...(typeof candidate.key === 'string' && candidate.key.trim()
          ? { key: redactText(candidate.key.trim()).slice(0, 200) }
          : {}),
        ...(typeof candidate.evidence === 'string' && candidate.evidence.trim()
          ? { evidence: redactText(candidate.evidence.trim()).slice(0, 4_000) }
          : {}),
      };
    }
    let workflow: WorkerReport['workflow'];
    if (value.workflow !== undefined) {
      if (!value.workflow || typeof value.workflow !== 'object' || Array.isArray(value.workflow)) {
        return undefined;
      }
      const candidate = value.workflow as Record<string, unknown>;
      const strings = (name: string, required: boolean): string[] | undefined => {
        const list = candidate[name];
        if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
          return required ? undefined : [];
        }
        const sanitized = [
          ...new Set(
            list
              .filter((item): item is string => typeof item === 'string')
              .map((item) => redactText(item.trim()).slice(0, 1_000))
              .filter(Boolean),
          ),
        ];
        return required && sanitized.length === 0 ? undefined : sanitized.slice(0, 20);
      };
      const task =
        typeof candidate.task === 'string' ? redactText(candidate.task.trim()).slice(0, 2_000) : '';
      const outcome =
        typeof candidate.outcome === 'string'
          ? redactText(candidate.outcome.trim()).slice(0, 2_000)
          : '';
      const steps = strings('steps', true);
      const tools = strings('tools', false);
      const validations = strings('validations', true);
      const scope = candidate.scope === 'global' ? 'global' : 'project';
      if (!task || !outcome || !steps || !tools || !validations) return undefined;
      workflow = { task, outcome, steps, tools, validations, scope };
    }
    let capabilityUse: WorkerReport['capabilityUse'];
    if (value.capabilityUse !== undefined) {
      if (!Array.isArray(value.capabilityUse) || value.capabilityUse.length > 24) return undefined;
      const seen = new Set<string>();
      capabilityUse = [];
      for (const item of value.capabilityUse) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const candidate = item as Record<string, unknown>;
        const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
        const evidence = typeof candidate.evidence === 'string' ? candidate.evidence.trim() : '';
        if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(key) || !evidence || seen.has(key)) return undefined;
        seen.add(key);
        capabilityUse.push({ key, evidence: redactText(evidence).slice(0, 2_000) });
      }
    }
    let assetCandidate: WorkerReport['assetCandidate'];
    if (value.assetCandidate !== undefined) {
      if (
        !value.assetCandidate ||
        typeof value.assetCandidate !== 'object' ||
        Array.isArray(value.assetCandidate)
      ) {
        return undefined;
      }
      const candidate = value.assetCandidate as Record<string, unknown>;
      const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
      const kind = typeof candidate.kind === 'string' ? candidate.kind.trim() : '';
      const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
      const locator = typeof candidate.locator === 'string' ? candidate.locator.trim() : '';
      const tags = Array.isArray(candidate.tags)
        ? [
            ...new Set(
              candidate.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ]
        : [];
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
        !kind ||
        !summary ||
        !locator ||
        locator.startsWith('/') ||
        locator.includes('..') ||
        tags.length === 0 ||
        tags.length > 20 ||
        !['shared', 'project-local'].includes(String(candidate.scope))
      ) {
        return undefined;
      }
      assetCandidate = {
        id,
        kind: redactText(kind).slice(0, 80),
        summary: redactText(summary).slice(0, 2_000),
        locator,
        tags: tags.map((tag) => redactText(tag).slice(0, 80)),
        scope: candidate.scope as 'shared' | 'project-local',
      };
    }
    return {
      status: value.status as WorkerReport['status'],
      summary,
      ...(taskId ? { taskId } : {}),
      ...(promotionEvidence ? { promotionEvidence } : {}),
      ...(independentReview ? { independentReview } : {}),
      ...(ownerGate ? { ownerGate } : {}),
      ...(learning ? { learning } : {}),
      ...(workflow ? { workflow } : {}),
      ...(assetCandidate ? { assetCandidate } : {}),
      ...(capabilityUse ? { capabilityUse } : {}),
      ...(writingDraft ? { writingDraft } : {}),
      ...(writingSourcePacket ? { writingSourcePacket } : {}),
      ...(writingEvidence ? { writingEvidence } : {}),
    };
  } catch {
    return undefined;
  }
}
