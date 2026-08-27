import type { ProviderInfo } from '../providers/types.js';

/**
 * Provider health is independent per provider. One provider's failure never
 * changes another provider's state, and the states below are deliberately
 * NOT a ranking of Major's overall health — a provider sitting at
 * AUTH_REQUIRED or EXHAUSTED is normal operating condition, not degradation
 * of the Major release itself. See docs/readiness-model.md.
 */
export const PROVIDER_READINESS_STATES = [
  'READY',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'EXHAUSTED',
  'UNAVAILABLE',
  'UNSUPPORTED_VERSION',
  'NOT_CONFIGURED',
] as const;
export type ProviderReadinessState = (typeof PROVIDER_READINESS_STATES)[number];

export interface ProviderReadiness {
  provider: string;
  state: ProviderReadinessState;
  detail: string;
  action?: string;
  /** ISO timestamp a backoff/reset window ends, when known. */
  retryAt?: string;
}

/**
 * Roll a provider's installed/authenticated/per-model state up into one
 * actionable status. A provider can have several models in different
 * availability states; the rollup takes the most favorable model (a single
 * usable model is enough to route work), then falls back through the
 * remaining states in order of "closest to usable first".
 */
export function computeProviderReadiness(
  info: ProviderInfo,
  options: { retryAt?: string } = {},
): ProviderReadiness {
  const provider = info.name;
  if (!info.installed) {
    return {
      provider,
      state: 'NOT_CONFIGURED',
      detail: 'provider client is not installed or not found on PATH',
      action: `install and authenticate ${provider} to enable it`,
    };
  }
  // info.authenticated is best-effort and frequently undefined (resolution-only
  // host discovery cannot verify it; loadPersistedProviderInfos never sets it
  // at all). The model list is the reliable signal: it always carries an
  // explicit authenticated flag per model.
  const authenticated = info.authenticated ?? info.models.some((m) => m.authenticated);
  if (!authenticated) {
    return {
      provider,
      state: 'AUTH_REQUIRED',
      detail: 'provider client is installed but not authenticated',
      action: `authenticate ${provider}`,
    };
  }
  const usableModel = info.models.find(
    (m) =>
      m.visible &&
      m.authenticated &&
      !m.prohibited &&
      m.availability === 'available' &&
      m.billingMode !== 'unknown',
  );
  if (usableModel) {
    return { provider, state: 'READY', detail: `${usableModel.modelRef} routable` };
  }
  const rateLimited = info.models.find((m) => m.availability === 'rate_limited');
  if (rateLimited) {
    const result: ProviderReadiness = {
      provider,
      state: 'RATE_LIMITED',
      detail: `${rateLimited.modelRef} is rate-limited`,
      action: 'wait for the rate limit to clear, or route to another provider',
    };
    if (options.retryAt) result.retryAt = options.retryAt;
    return result;
  }
  const exhausted = info.models.find((m) => m.availability === 'exhausted');
  if (exhausted) {
    const result: ProviderReadiness = {
      provider,
      state: 'EXHAUSTED',
      detail: `${exhausted.modelRef} has exhausted its quota`,
      action: 'wait for quota reset, or manually switch to another account/subscription',
    };
    if (options.retryAt) result.retryAt = options.retryAt;
    return result;
  }
  return {
    provider,
    state: 'UNAVAILABLE',
    detail:
      info.models.length === 0
        ? 'authenticated but no model has been discovered yet'
        : 'authenticated but no model is routable (billing not yet attested)',
    action:
      info.models.length === 0
        ? 'run major doctor to discover models'
        : 'run major provider attest-billing for this provider',
  };
}

export interface CoreReadiness {
  ready: boolean;
  issues: string[];
}

/**
 * Core platform safety: the selected execution boundary itself (containment,
 * release/runtime integrity, required prerequisites). This is deliberately NOT
 * about any one provider's auth/billing state - a provider being unauthenticated
 * does not make the core unsafe.
 */
export function computeCoreReadiness(input: {
  runnerCapabilityAvailable: boolean;
  containmentReady: boolean;
  containmentDetail: string;
  missingRequiredPrerequisites: string[];
}): CoreReadiness {
  const issues: string[] = [];
  if (!input.runnerCapabilityAvailable) {
    issues.push('execution boundary capability is disabled in this build');
  }
  if (!input.containmentReady) {
    issues.push(`containment insufficient: ${input.containmentDetail}`);
  }
  if (input.missingRequiredPrerequisites.length > 0) {
    issues.push(`missing required prerequisites: ${input.missingRequiredPrerequisites.join(', ')}`);
  }
  return { ready: issues.length === 0, issues };
}

export interface LiveExecutionReadiness {
  ready: boolean;
  healthyProviders: string[];
  fallbackCount: number;
  blockers: string[];
}

/**
 * liveExecutionReady = coreReady AND at least one provider is READY. A
 * provider being AUTH_REQUIRED/EXHAUSTED/etc. never globally disables Major
 * while another provider remains READY.
 */
export function computeLiveExecutionReadiness(
  core: CoreReadiness,
  providers: ProviderReadiness[],
): LiveExecutionReadiness {
  const healthyProviders = providers.filter((p) => p.state === 'READY').map((p) => p.provider);
  const blockers = [...core.issues];
  if (healthyProviders.length === 0) {
    blockers.push(
      'no provider is READY: ' +
        (providers.length === 0
          ? 'no providers configured'
          : providers.map((p) => `${p.provider}=${p.state}`).join(', ')),
    );
  }
  return {
    ready: core.ready && healthyProviders.length > 0,
    healthyProviders,
    fallbackCount: Math.max(0, healthyProviders.length - 1),
    blockers,
  };
}

export interface MultiProviderReadiness {
  ready: boolean;
  healthyCount: number;
}

/** More than one healthy provider means Major can fail over, not merely run. */
export function computeMultiProviderReadiness(
  live: LiveExecutionReadiness,
): MultiProviderReadiness {
  return { ready: live.healthyProviders.length > 1, healthyCount: live.healthyProviders.length };
}
