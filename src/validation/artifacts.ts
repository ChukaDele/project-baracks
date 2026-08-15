import { evaluateShipGate, type GateCheck, type ShipGateResult } from './ship-gate.js';

export const ARTIFACT_KINDS = ['writing', 'code', 'web', 'analysis', 'presentation'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ArtifactValidationInput {
  kind: ArtifactKind;
  content?: string;
  evidence?: Record<string, boolean>;
  web?: { publicSite?: boolean; checks: GateCheck[] };
}

export interface ArtifactValidationResult {
  kind: ArtifactKind;
  deterministicChecks: ArtifactCheck[];
  shipGate?: ShipGateResult;
  deterministicPassed: boolean;
  needsIndependentReview: boolean;
}

const GENERIC_WRITING = [
  /\bdelve into\b/i,
  /\bleverage the power of\b/i,
  /\bin today's fast-paced\b/i,
  /\bgame[- ]changer\b/i,
];

function evidenceChecks(required: readonly string[], evidence: Record<string, boolean> = {}) {
  return required.map((id) => ({
    id,
    passed: evidence[id] === true,
    detail: evidence[id] === true ? 'passed' : 'missing or failed',
  }));
}

function writingChecks(content: string): ArtifactCheck[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().toLowerCase())
    .filter(Boolean);
  const duplicatedParagraph = new Set(paragraphs).size !== paragraphs.length;
  return [
    {
      id: 'writing-specific-language',
      passed: !GENERIC_WRITING.some((pattern) => pattern.test(content)),
      detail: 'rejects known generic filler phrases',
    },
    {
      id: 'writing-no-duplicate-paragraphs',
      passed: !duplicatedParagraph,
      detail: 'rejects repeated paragraphs',
    },
  ];
}

/**
 * Artifact-aware deterministic checks run before any optional model review.
 * Evidence names intentionally express claims that a runtime adapter must
 * prove; this module does not turn a caller assertion into a production fact.
 */
export function validateArtifact(input: ArtifactValidationInput): ArtifactValidationResult {
  const content = input.content ?? '';
  let deterministicChecks: ArtifactCheck[];
  let shipGate: ShipGateResult | undefined;
  switch (input.kind) {
    case 'writing':
      deterministicChecks = writingChecks(content);
      break;
    case 'code':
      deterministicChecks = evidenceChecks(
        ['code-typecheck', 'code-tests', 'code-security-review', 'code-dependency-review'],
        input.evidence,
      );
      break;
    case 'analysis':
      deterministicChecks = evidenceChecks(
        ['analysis-claims-cited', 'analysis-counterargument', 'analysis-staleness-checked'],
        input.evidence,
      );
      break;
    case 'presentation':
      deterministicChecks = evidenceChecks(
        ['presentation-readable-density', 'presentation-evidence', 'presentation-narrative'],
        input.evidence,
      );
      break;
    case 'web':
      if (!input.web) throw new Error('web artifact validation requires ship-gate evidence');
      shipGate = evaluateShipGate(input.web);
      deterministicChecks = [
        {
          id: 'web-ship-gate',
          passed: shipGate.deterministicPassed,
          detail: shipGate.deterministicPassed
            ? 'all applicable ship checks passed'
            : shipGate.blockers.join('; '),
        },
      ];
      break;
  }
  const deterministicPassed = deterministicChecks.every((check) => check.passed);
  return {
    kind: input.kind,
    deterministicChecks,
    ...(shipGate ? { shipGate } : {}),
    deterministicPassed,
    needsIndependentReview: true,
  };
}
