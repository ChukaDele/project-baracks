/**
 * Build-level capability availability. This foundation build is DRY-RUN AND
 * INSPECTION ONLY: the five capabilities below remain unavailable. Their
 * release-candidate boundaries are implemented, but none may become reachable
 * until the combined exact head passes fresh independent review and field
 * validation.
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
      'the combined trusted-executable and macOS isolation boundary has not yet passed ' +
      'fresh independent review and provider field validation',
    milestone: 'M1 — combined validation and activation',
  }),
  'paid-provider-execution': Object.freeze({
    reason:
      'the combined authoritative billing and one-use paid approval boundary has not yet ' +
      'passed fresh independent review',
    milestone: 'M2 — combined validation and activation',
  }),
  'automated-task-completion': Object.freeze({
    reason:
      'the combined immutable task-specific completion proof has not yet passed fresh ' +
      'independent review',
    milestone: 'M3 — combined validation and activation',
  }),
  'worker-owned-downstream-mutations': Object.freeze({
    reason:
      'the combined worker and downstream-write fencing boundary has not yet passed fresh ' +
      'independent review',
    milestone: 'M4 — combined validation and activation',
  }),
  'external-roadmap-application': Object.freeze({
    reason:
      'the combined exact-attempt roadmap reconciliation boundary has not yet passed fresh ' +
      'independent review or a representative live adapter test',
    milestone: 'M5 — combined validation and activation',
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
