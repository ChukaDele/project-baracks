/**
 * Major capabilities that must survive the DeepSeek Harness strangler.
 * ADOPT/WRAP never delete these; they become overlay plugins or stay in the kernel.
 */
export const MAJOR_RETAINED_CAPABILITIES = [
  'durable-goals',
  'gbrain-learning',
  'skill-resolver',
  'toolsmith',
  'policy-autonomy',
  'evidence-validation',
  'project-integrity',
  'subscription-routing',
  'kill-switch',
  'lima-isolation',
] as const;

export type MajorRetainedCapability = (typeof MAJOR_RETAINED_CAPABILITIES)[number];

export type ReuseDecision = 'ADOPT' | 'WRAP' | 'KEEP' | 'BUILD';

export interface CapabilityReuseRecord {
  capability: MajorRetainedCapability;
  decision: ReuseDecision;
  owner: 'major-kernel' | 'major-plugin' | 'upstream-dsh' | 'lima';
  note: string;
}

export const CAPABILITY_REUSE: readonly CapabilityReuseRecord[] = [
  {
    capability: 'durable-goals',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'No upstream covers cross-project durable goals.',
  },
  {
    capability: 'gbrain-learning',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'dsh session log is WRAP for run traces only; GBrain stays Major.',
  },
  {
    capability: 'skill-resolver',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'dsh skills are instruction packages; Major resolver remains policy.',
  },
  {
    capability: 'toolsmith',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'Capability lifecycle is Major-specific.',
  },
  {
    capability: 'policy-autonomy',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'WRAP dsh approval transport; Major owns owner-gates and trust.',
  },
  {
    capability: 'evidence-validation',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'Independent evidence and graders stay in Major.',
  },
  {
    capability: 'project-integrity',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'Canonical repo identity is a Major boundary.',
  },
  {
    capability: 'subscription-routing',
    decision: 'KEEP',
    owner: 'major-plugin',
    note: 'dsh model adapters are ADOPT later; routing/billing stay Major.',
  },
  {
    capability: 'kill-switch',
    decision: 'KEEP',
    owner: 'major-kernel',
    note: 'major stop remains the global execution brake.',
  },
  {
    capability: 'lima-isolation',
    decision: 'KEEP',
    owner: 'lima',
    note: 'Optional high-isolation and legacy compatibility backend for DSH execution.',
  },
];

export function missingRetainedCapabilities(present: readonly string[]): MajorRetainedCapability[] {
  const set = new Set(present);
  return MAJOR_RETAINED_CAPABILITIES.filter((capability) => !set.has(capability));
}
