import type { BillingMode, RoutingClass, RunPurpose, TaskComplexity } from '../db/schema.js';
import type { ModelState, ProviderInfo } from '../providers/types.js';
import { isCapabilityAvailable } from '../security/capabilities.js';

export type RiskLevel = 'normal' | 'high' | 'security_sensitive';

export interface RoutingRequest {
  purpose: RunPurpose;
  complexity: TaskComplexity;
  riskLevel?: RiskLevel;
  /** Provider that produced the work under review (for independence checks). */
  implementedByProvider?: string;
  /** Prior failed repair attempts on this task; drives escalation. */
  repairAttempts?: number;
  /** Explicit approval for paid capacity. Subscription-included capacity needs none. */
  approvedPaidUsage?: { decisionId: string };
}

export interface RoutingOptions {
  /** Optional escape hatch for a project that explicitly wants to reserve Codex. Default false. */
  preserveCodexForReview?: boolean;
}

export interface Candidate {
  provider: string;
  model: ModelState;
}

export type RoutingDecision =
  | {
      kind: 'route';
      provider: string;
      modelRef: string;
      routingClass: RoutingClass;
      billingMode: BillingMode;
      reason: string;
      paidUsageDecisionId?: string;
      independenceLoss?: string;
    }
  | {
      kind: 'checkpoint';
      reason: string;
      paidOptionsAvailable: Candidate[];
    };

const FREE_BILLING: BillingMode = 'subscription_included';

/**
 * Preference ladders. Codex is normal implementation capacity, not a review-only reserve.
 * The router still prefers the requested Claude quality class first where available and
 * uses Codex as a strong subscription-backed fallback before dropping below the intended class.
 */
const LADDERS: Record<Exclude<RoutingClass, 'unknown'>, RoutingClass[]> = {
  fable: ['fable', 'opus', 'codex', 'sonnet'],
  opus: ['opus', 'fable', 'codex', 'sonnet'],
  sonnet: ['sonnet', 'codex', 'opus'],
  codex: ['codex', 'opus', 'sonnet', 'fable'],
};

function escalate(target: Exclude<RoutingClass, 'unknown' | 'codex'>): typeof target {
  if (target === 'sonnet') return 'opus';
  if (target === 'opus') return 'fable';
  return 'fable';
}

export function targetClass(request: RoutingRequest): Exclude<RoutingClass, 'unknown' | 'codex'> {
  let target: Exclude<RoutingClass, 'unknown' | 'codex'>;
  if (request.riskLevel === 'security_sensitive' || request.riskLevel === 'high') {
    target = 'opus';
  } else if (request.complexity === 'architectural') {
    target = 'fable';
  } else if (request.complexity === 'complex') {
    target =
      request.purpose === 'analysis' || request.purpose === 'implementation' ? 'fable' : 'opus';
  } else {
    target = 'sonnet';
  }
  const escalations = Math.min(2, Math.floor((request.repairAttempts ?? 0) / 2));
  for (let i = 0; i < escalations; i++) target = escalate(target);
  return target;
}

function usable(candidate: Candidate): boolean {
  const m = candidate.model;
  return (
    m.visible &&
    m.authenticated &&
    !m.prohibited &&
    (m.availability === 'available' || m.retryEligible === true) &&
    m.billingMode !== 'unknown'
  );
}

function collectCandidates(providers: ProviderInfo[]): Candidate[] {
  return providers.flatMap((p) => p.models.map((model) => ({ provider: p.name, model })));
}

function pickFromLadder(
  ladder: RoutingClass[],
  candidates: Candidate[],
  request: RoutingRequest,
  options: RoutingOptions,
): { free?: Candidate; paid: Candidate[] } {
  const preserveCodex = options.preserveCodexForReview ?? false;
  const paid: Candidate[] = [];
  for (const cls of ladder) {
    for (const candidate of candidates) {
      if (candidate.model.routingClass !== cls || !usable(candidate)) continue;
      if (
        preserveCodex &&
        candidate.model.routingClass === 'codex' &&
        request.purpose !== 'review'
      ) {
        continue;
      }
      if (candidate.model.billingMode === FREE_BILLING) return { free: candidate, paid };
      paid.push(candidate);
    }
  }
  return { paid };
}

export function route(
  request: RoutingRequest,
  providers: ProviderInfo[],
  options: RoutingOptions = {},
): RoutingDecision {
  const candidates = collectCandidates(providers);
  const isReview = request.purpose === 'review';
  const target = isReview ? 'codex' : targetClass(request);

  const ladder: RoutingClass[] = isReview ? ['codex', 'opus', 'fable', 'sonnet'] : LADDERS[target];

  let pool = candidates;
  let independenceLoss: string | undefined;
  if (isReview && request.implementedByProvider) {
    const independent = candidates.filter((c) => c.provider !== request.implementedByProvider);
    const { free } = pickFromLadder(ladder, independent, request, options);
    if (free) {
      pool = independent;
    } else {
      independenceLoss = `no independent provider available; review by ${request.implementedByProvider} of its own work`;
    }
  }

  const { free, paid } = pickFromLadder(ladder, pool, request, options);

  if (free) {
    const decision: RoutingDecision = {
      kind: 'route',
      provider: free.provider,
      modelRef: free.model.modelRef,
      routingClass: free.model.routingClass,
      billingMode: free.model.billingMode,
      reason:
        `purpose=${request.purpose} complexity=${request.complexity} ` +
        `risk=${request.riskLevel ?? 'normal'} target=${target} -> ` +
        `${free.provider}/${free.model.modelRef} (${free.model.routingClass}, ` +
        `${free.model.billingMode})`,
    };
    if (independenceLoss) decision.independenceLoss = independenceLoss;
    return decision;
  }

  if (
    paid.length > 0 &&
    request.approvedPaidUsage &&
    isCapabilityAvailable('paid-provider-execution')
  ) {
    const chosen = paid[0]!;
    const decision: RoutingDecision = {
      kind: 'route',
      provider: chosen.provider,
      modelRef: chosen.model.modelRef,
      routingClass: chosen.model.routingClass,
      billingMode: chosen.model.billingMode,
      paidUsageDecisionId: request.approvedPaidUsage.decisionId,
      reason:
        `no subscription-included model usable for target=${target}; ` +
        `paid usage of ${chosen.provider}/${chosen.model.modelRef} ` +
        `(${chosen.model.billingMode}) approved by ${request.approvedPaidUsage.decisionId}`,
    };
    if (independenceLoss) decision.independenceLoss = independenceLoss;
    return decision;
  }

  return {
    kind: 'checkpoint',
    reason:
      paid.length > 0
        ? `only paid options remain for target=${target} (purpose=${request.purpose}); ` +
          'paid provider execution is unavailable in this build — checkpointing instead ' +
          'of creating an unapproved charge'
        : `no usable model for target=${target} (purpose=${request.purpose}); ` +
          'checkpointing until availability recovers',
    paidOptionsAvailable: paid,
  };
}
