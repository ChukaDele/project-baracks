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
  /**
   * Explicit human approval to spend usage credits or API billing: the id of
   * an APPROVED 'paid_usage' DecisionRequest, verified by the caller against
   * the database (see domain/decision-service.ts#isApprovedDecision). A bare
   * boolean is deliberately not accepted. In this build the reference can
   * never produce a paid route: paid provider execution is an unavailable
   * capability, so the router checkpoints instead (milestone M2).
   */
  approvedPaidUsage?: { decisionId: string };
}

export interface RoutingOptions {
  /** Keep Codex capacity for independent review (default true). */
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
      /** The approving DecisionRequest, present iff the route is paid. */
      paidUsageDecisionId?: string;
      /** Set when review independence was lost (same-provider review). */
      independenceLoss?: string;
    }
  | {
      kind: 'checkpoint';
      reason: string;
      /** Paid options that exist but were not authorised. */
      paidOptionsAvailable: Candidate[];
    };

const FREE_BILLING: BillingMode = 'subscription_included';

/** Preference ladder per target class. Never silently climbs INTO fable for
 * routine work, and never falls below sonnet-class quality floors. */
const LADDERS: Record<Exclude<RoutingClass, 'unknown'>, RoutingClass[]> = {
  fable: ['fable', 'opus', 'sonnet'],
  opus: ['opus', 'fable', 'sonnet'],
  sonnet: ['sonnet', 'opus'],
  codex: ['codex'],
};

function escalate(target: Exclude<RoutingClass, 'unknown' | 'codex'>): typeof target {
  if (target === 'sonnet') return 'opus';
  if (target === 'opus') return 'fable';
  return 'fable';
}

/** Map task shape to the routing class the quality policy asks for. */
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
  // Repeated failure escalates one class per two failed repair attempts.
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
    m.availability === 'available' &&
    // Unknown billing is unroutable: we cannot prove the run would be free.
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
  const preserveCodex = options.preserveCodexForReview ?? true;
  const paid: Candidate[] = [];
  for (const cls of ladder) {
    for (const candidate of candidates) {
      if (candidate.model.routingClass !== cls || !usable(candidate)) continue;
      // Codex reserve: outside review, do not consume Codex capacity.
      if (
        preserveCodex &&
        candidate.model.routingClass === 'codex' &&
        request.purpose !== 'review'
      ) {
        continue;
      }
      if (candidate.model.billingMode === FREE_BILLING) {
        return { free: candidate, paid };
      }
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

  // Reviews prefer Codex for cross-provider independence, then any other
  // provider that did not produce the work, then (recorded) same-provider.
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

  // Only paid options remain. Paid provider execution is unavailable in this
  // build: even an approved DecisionRequest reference cannot route to paid
  // capacity (capability gate, milestone M2) — the router checkpoints instead
  // of ever creating a charge. The branch below is retained for M2 but is
  // unreachable until then.
  if (paid.length > 0 && request.approvedPaidUsage && isCapabilityAvailable('paid-provider-execution')) {
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
