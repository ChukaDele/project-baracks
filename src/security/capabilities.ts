/**
 * Build-level capability availability. This foundation build is DRY-RUN AND
 * INSPECTION ONLY: the five capabilities below are unavailable because their
 * security boundaries are incomplete (independent review found each one
 * bypassable at its claimed boundary). Each is quarantined behind this module
 * and re-enabled only by its own follow-up milestone
 * (docs/deferred-security-milestones.md) plus a fresh independent review.
 *
 * These are CODE CONSTANTS, deliberately not configuration: no config file,
 * environment variable, CLI flag, database row or constructor option is
 * consulted, so nothing outside a reviewed code change can enable a
 * capability. A doctor warning or a configuration flag is never treated as
 * enforcement — the enforcement is the unconditional refusal in the code
 * paths that call into this module.
 */

export const UNAVAILABLE_CAPABILITIES = Object.freeze({
  'live-agent-execution': Object.freeze({
    reason:
      'executable identity is not content-verified at the spawn boundary and no OS-level ' +
      'filesystem/network isolation is enforced',
    milestone: 'M1 — trusted OS-isolated execution',
  }),
  'paid-provider-execution': Object.freeze({
    reason:
      'billing authority and one-use, purpose-scoped paid approval are not enforced at the ' +
      'durable boundary',
    milestone: 'M2 — authoritative provider and billing control',
  }),
  'automated-task-completion': Object.freeze({
    reason:
      'task completion criteria are mutable, so the completion proof is not task-specific ' +
      'and immutable',
    milestone: 'M3 — immutable database completion proof',
  }),
  'worker-owned-downstream-mutations': Object.freeze({
    reason:
      'lease fencing does not cover every owner mutation and downstream write ' +
      '(evidence, optional fences, review and roadmap-proposal writes)',
    milestone: 'M4 — complete worker fencing',
  }),
  'external-roadmap-application': Object.freeze({
    reason:
      'apply reconciliation does not compare-and-swap against the exact observed attempt, ' +
      'so a delayed reconciler can displace a newer in-flight attempt',
    milestone: 'M5 — crash-safe external roadmap application',
  }),
} as const);

export type UnavailableCapability = keyof typeof UNAVAILABLE_CAPABILITIES;

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: UnavailableCapability) {
    const entry = UNAVAILABLE_CAPABILITIES[capability];
    super(
      `capability '${capability}' is not available in this build: ${entry.reason} ` +
        `(deferred to ${entry.milestone})`,
    );
    this.name = 'CapabilityUnavailableError';
  }
}

/**
 * Whether a capability is available in this build. Always false for the five
 * quarantined capabilities — the boolean return type exists so guarded code
 * paths stay compiled and type-checked while remaining unreachable at
 * runtime.
 */
export function isCapabilityAvailable(capability: UnavailableCapability): boolean {
  return !(capability in UNAVAILABLE_CAPABILITIES);
}

/** Fail closed: throw unless the capability is available (it never is). */
export function assertCapabilityAvailable(capability: UnavailableCapability): void {
  if (!isCapabilityAvailable(capability)) {
    throw new CapabilityUnavailableError(capability);
  }
}

export interface CapabilityStatus {
  capability: UnavailableCapability;
  available: false;
  reason: string;
  milestone: string;
}

/** The five unavailable capabilities as report rows (doctor, docs, tests). */
export function unavailableCapabilityStatuses(): CapabilityStatus[] {
  return (Object.keys(UNAVAILABLE_CAPABILITIES) as UnavailableCapability[]).map((capability) => ({
    capability,
    available: false,
    reason: UNAVAILABLE_CAPABILITIES[capability].reason,
    milestone: UNAVAILABLE_CAPABILITIES[capability].milestone,
  }));
}
