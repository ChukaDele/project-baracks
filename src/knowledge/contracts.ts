export type ExecutionClass = 'safe-deterministic' | 'reasoning-required';

export interface StrategicReadingOutput {
  mechanisms: string[];
  limits: string[];
  contradictions: string[];
  actions: string[];
  indicators: string[];
  executionClass: ExecutionClass;
}

export function strategicReadingFindings(
  input: Omit<StrategicReadingOutput, 'executionClass'>,
): StrategicReadingOutput {
  const clean = (values: string[]) => [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return {
    mechanisms: clean(input.mechanisms),
    limits: clean(input.limits),
    contradictions: clean(input.contradictions),
    actions: clean(input.actions),
    indicators: clean(input.indicators),
    executionClass: 'reasoning-required',
  };
}

export type LineageTransition = 'introduced' | 'refined' | 'challenged' | 'abandoned' | 'revived';
export interface IdeaLineageEvent {
  ideaId: string;
  transition: LineageTransition;
  sourceRef: string;
  observedAt: string;
}

export function orderIdeaLineage(events: readonly IdeaLineageEvent[]): {
  events: IdeaLineageEvent[];
  invalid: IdeaLineageEvent[];
  contradictory: { ideaId: string; observedAt: string; transitions: LineageTransition[] }[];
} {
  const invalid = events.filter(
    (event) =>
      !event.ideaId.trim() ||
      !event.sourceRef.trim() ||
      !Number.isFinite(Date.parse(event.observedAt)),
  );
  const valid = events
    .filter((event) => !invalid.includes(event))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const groups = new Map<string, Set<LineageTransition>>();
  for (const event of valid) {
    const key = `${event.ideaId}\0${event.observedAt}`;
    groups.set(key, new Set([...(groups.get(key) ?? []), event.transition]));
  }
  const contradictory = [...groups]
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => {
      const [ideaId, observedAt] = key.split('\0');
      return { ideaId: ideaId!, observedAt: observedAt!, transitions: [...values] };
    });
  return { events: valid, invalid, contradictory };
}

export type ConceptRelationship =
  'supports' | 'contradicts' | 'qualifies' | 'extends' | 'minority-alternative';
export interface ConceptSynthesisEdge {
  from: string;
  to: string;
  relationship: ConceptRelationship;
  sourceRefs: string[];
}

export function validateConceptSynthesis(edges: readonly ConceptSynthesisEdge[]): {
  accepted: ConceptSynthesisEdge[];
  findings: string[];
  executionClass: ExecutionClass;
} {
  const findings: string[] = [];
  const accepted = edges.filter((edge, index) => {
    if (!edge.from.trim() || !edge.to.trim() || edge.from === edge.to) {
      findings.push(`edge-${index}-entities-invalid`);
      return false;
    }
    if (edge.sourceRefs.length === 0 || edge.sourceRefs.some((source) => !source.trim())) {
      findings.push(`edge-${index}-provenance-required`);
      return false;
    }
    const inverse = edges.find(
      (candidate) => candidate.from === edge.to && candidate.to === edge.from,
    );
    if (inverse && inverse.relationship !== edge.relationship)
      findings.push(`edge-${index}-contradictory-reciprocal`);
    return true;
  });
  return { accepted, findings: [...new Set(findings)], executionClass: 'reasoning-required' };
}

export interface ResearchCompendium {
  question: string;
  sources: { locator: string; retrievedAt: string }[];
  claims: { text: string; sourceLocators: string[] }[];
  conclusions: { text: string; basisClaimIndexes: number[] }[];
  unresolved: string[];
}

export type EvidenceStrength =
  'unsupported' | 'single-source' | 'corroborated' | 'primary-replicated';
export function academicEvidenceStrength(input: {
  sourceCount: number;
  primary: boolean;
  replicated: boolean;
}): EvidenceStrength {
  if (input.sourceCount <= 0) return 'unsupported';
  if (input.primary && input.replicated && input.sourceCount >= 2) return 'primary-replicated';
  if (input.sourceCount >= 2) return 'corroborated';
  return 'single-source';
}

export function validateCompendium(value: ResearchCompendium): string[] {
  const errors: string[] = [];
  if (!value.question.trim()) errors.push('question-required');
  value.sources.forEach((source, index) => {
    if (!source.locator.trim() || !Number.isFinite(Date.parse(source.retrievedAt)))
      errors.push(`source-${index}-invalid`);
  });
  const locators = new Set(value.sources.map((source) => source.locator));
  value.claims.forEach((claim, index) => {
    if (
      claim.sourceLocators.length === 0 ||
      claim.sourceLocators.some((locator) => !locators.has(locator))
    )
      errors.push(`claim-${index}-source-invalid`);
  });
  value.conclusions.forEach((conclusion, index) => {
    if (
      conclusion.basisClaimIndexes.length === 0 ||
      conclusion.basisClaimIndexes.some((claim) => claim < 0 || claim >= value.claims.length)
    )
      errors.push(`conclusion-${index}-basis-invalid`);
  });
  return errors;
}

export interface AcademicVerificationFinding {
  strength: EvidenceStrength;
  findings: string[];
  executionClass: ExecutionClass;
}

export function verifyAcademicEvidence(input: {
  sourceCount: number;
  primary: boolean;
  replicated: boolean;
  methodologyPresent: boolean;
  limitationsPresent: boolean;
  contradictoryResults: boolean;
}): AcademicVerificationFinding {
  const findings: string[] = [];
  if (!Number.isInteger(input.sourceCount) || input.sourceCount < 0)
    findings.push('source-count-invalid');
  if (!input.methodologyPresent) findings.push('methodology-missing');
  if (!input.limitationsPresent) findings.push('limitations-missing');
  if (input.replicated && input.sourceCount < 2) findings.push('replication-unsupported');
  if (input.contradictoryResults) findings.push('contradictory-results-unresolved');
  return {
    strength: findings.includes('source-count-invalid')
      ? 'unsupported'
      : academicEvidenceStrength(input),
    findings,
    executionClass: 'reasoning-required',
  };
}
