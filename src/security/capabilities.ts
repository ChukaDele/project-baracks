/**
 * Build-level capability availability. The five v0.5.1 capability boundaries
 * remain immutable code gates.
 *
 * `live-agent-execution` gates CORE PLATFORM SAFETY ONLY: is the isolated
 * Lima runner mechanism itself (containment, credential broker, guest user
 * isolation, release/runtime integrity) sound enough to let ANY provider
 * execute inside it. It is deliberately NOT "have all providers passed
 * field validation" — that would conflate a build-wide safety property with
 * per-provider auth/billing/quota health, which changes constantly (account
 * swaps, OAuth refreshes, quota resets) and must never force a new release.
 * Per-provider readiness is computed independently in
 * src/doctor/readiness.ts and never mutates this flag. See
 * docs/readiness-model.md.
 *
 * These are CODE CONSTANTS, deliberately not configuration: no config file,
 * environment variable, CLI flag, database row or constructor option is
 * consulted, so nothing outside a reviewed code change can enable a
 * capability. A doctor warning or a configuration flag is never treated as
 * enforcement — the enforcement is the unconditional refusal in the code
 * paths that call into this module.
 */

export const CAPABILITY_DEFINITIONS = Object.freeze({
  'live-agent-execution': Object.freeze({
    available: true,
    reason:
      'isolated Lima runner mechanism (containment, credential broker, guest isolation, ' +
      'release integrity) independently verified safe; per-provider auth/billing/field ' +
      'health is tracked separately in src/doctor/readiness.ts and never gates this flag',
    milestone: 'M1 — core runner activated for v0.5.2',
  }),
  'paid-provider-execution': Object.freeze({
    available: true,
    reason: 'paid execution requires authoritative billing evidence and one-use approval',
    milestone: 'M2 — activated for v0.5.1',
  }),
  'automated-task-completion': Object.freeze({
    available: true,
    reason: 'automated completion requires immutable task-specific proof',
    milestone: 'M3 — activated for v0.5.1',
  }),
  'worker-owned-downstream-mutations': Object.freeze({
    available: true,
    reason: 'worker-owned mutations require a live claim and exact fencing token',
    milestone: 'M4 — activated for v0.5.1',
  }),
  'external-roadmap-application': Object.freeze({
    available: true,
    reason: 'external roadmap writes require approved dry-run-bound exact-attempt reconciliation',
    milestone: 'M5 — activated for v0.5.1',
  }),
} as const);

export type Capability = keyof typeof CAPABILITY_DEFINITIONS;
/** Backward-compatible name retained for foundation API consumers. */
export type UnavailableCapability = Capability;

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: Capability) {
    const entry = CAPABILITY_DEFINITIONS[capability];
    super(
      `capability '${capability}' is not available in this build: ${entry.reason} ` +
        `(${entry.milestone})`,
    );
    this.name = 'CapabilityUnavailableError';
  }
}

/**
 * Whether a capability is available in this build. Availability is an
 * immutable reviewed code constant. This keeps every guarded path compiled
 * while making activation an explicit one-line code review rather than the
 * impossible act of deleting a key that the type system still requires.
 */
export function isCapabilityAvailable(capability: Capability): boolean {
  return CAPABILITY_DEFINITIONS[capability].available;
}

/** Fail closed if a future build deliberately disables a capability. */
export function assertCapabilityAvailable(capability: Capability): void {
  if (!isCapabilityAvailable(capability)) {
    throw new CapabilityUnavailableError(capability);
  }
}

export interface CapabilityStatus {
  capability: Capability;
  available: boolean;
  reason: string;
  milestone: string;
}

/** All build capabilities as report rows (doctor, docs, tests). */
export function capabilityStatuses(): CapabilityStatus[] {
  return (Object.keys(CAPABILITY_DEFINITIONS) as Capability[]).map((capability) => ({
    capability,
    available: CAPABILITY_DEFINITIONS[capability].available,
    reason: CAPABILITY_DEFINITIONS[capability].reason,
    milestone: CAPABILITY_DEFINITIONS[capability].milestone,
  }));
}
