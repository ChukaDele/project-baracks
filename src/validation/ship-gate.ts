export type CheckState = 'pass' | 'fail' | 'not_applicable';

export interface GateCheck {
  id: string;
  state: CheckState;
  evidence?: string;
}

export interface ShipGateInput {
  publicSite?: boolean;
  checks: readonly GateCheck[];
}

export interface ShipGateResult {
  deterministicPassed: boolean;
  required: string[];
  blockers: string[];
}

const BASE_REQUIREMENTS = [
  'functional-critical-journey',
  'functional-error-state',
  'data-source',
  'data-empty-error-state',
  'visual-desktop',
  'visual-mobile',
  'technical-build',
  'technical-console-network',
  'performance-obvious-regression',
  'security-secrets-boundary',
  'security-auth-boundary',
  'deployment-environment',
  'deployment-health',
] as const;

const PUBLIC_REQUIREMENTS = [
  'seo-title-metadata',
  'seo-og',
  'seo-sitemap-robots-canonical',
  'seo-headings-links',
] as const;

/**
 * Evaluate supplied runtime evidence. The gate does not pretend a green build
 * proves browser, deployment, or provider behaviour: absent evidence blocks
 * the applicable requirement.
 */
export function evaluateShipGate(input: ShipGateInput): ShipGateResult {
  const required = [...BASE_REQUIREMENTS, ...(input.publicSite ? PUBLIC_REQUIREMENTS : [])];
  const byId = new Map(input.checks.map((check) => [check.id, check]));
  const blockers = required.flatMap((id) => {
    const check = byId.get(id);
    if (!check) return [`${id}: evidence is missing`];
    if (check.state !== 'pass') return [`${id}: ${check.state}`];
    if (!check.evidence?.trim()) return [`${id}: pass has no evidence`];
    return [];
  });
  return { deterministicPassed: blockers.length === 0, required, blockers };
}
