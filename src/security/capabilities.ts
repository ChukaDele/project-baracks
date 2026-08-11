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

export const CAPABILITY_DEFINITIONS = Object.freeze({
  'live-agent-execution': Object.freeze({
    available: false,
    reason:
      'the combined trusted-executable and macOS isolation boundary has not yet passed ' +
      'fresh independent review and provider field validation',
    milestone: 'M1 — combined validation and activation',
  }),
  'paid-provider-execution': Object.freeze({
    available: false,
    reason:
      'the combined authoritative billing and one-use paid approval boundary has not yet ' +
      'passed fresh independent review',
    milestone: 'M2 — combined validation and activation',
  }),
  'automated-task-completion': Object.freeze({
    available: false,
    reason:
      'the combined immutable task-specific completion proof has not yet passed fresh ' +
      'independent review',
    milestone: 'M3 — combined validation and activation',
  }),
  'worker-owned-downstream-mutations': Object.freeze({
    available: false,
    reason:
      'the combined worker and downstream-write fencing boundary has not yet passed fresh ' +
      'independent review',
    milestone: 'M4 — combined validation and activation',
  }),
  'external-roadmap-application': Object.freeze({
    available: false,
    reason:
      'the combined exact-attempt roadmap reconciliation boundary has not yet passed fresh ' +
      'independent review or a representative live adapter test',
    milestone: 'M5 — combined validation and activation',
  }),
} as const);

export type UnavailableCapability = keyof typeof CAPABILITY_DEFINITIONS;

export class CapabilityUnavailableError extends Error {
  constructor(readonly capability: UnavailableCapability) {
    const entry = CAPABILITY_DEFINITIONS[capability];
    super(
      `capability '${capability}' is not available in this build: ${entry.reason} ` +
        `(deferred to ${entry.milestone})`,
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
export function isCapabilityAvailable(capability: UnavailableCapability): boolean {
  return CAPABILITY_DEFINITIONS[capability].available;
}

/** Fail closed: throw unless the capability is available (it never is). */
export function assertCapabilityAvailable(capability: UnavailableCapability): void {
  if (!isCapabilityAvailable(capability)) {
    throw new CapabilityUnavailableError(capability);
  }
}

export interface CapabilityStatus {
  capability: UnavailableCapability;
  available: boolean;
  reason: string;
  milestone: string;
}

/** All build capabilities as report rows (doctor, docs, tests). */
export function capabilityStatuses(): CapabilityStatus[] {
  return (Object.keys(CAPABILITY_DEFINITIONS) as UnavailableCapability[]).map((capability) => ({
    capability,
    available: CAPABILITY_DEFINITIONS[capability].available,
    reason: CAPABILITY_DEFINITIONS[capability].reason,
    milestone: CAPABILITY_DEFINITIONS[capability].milestone,
  }));
}
