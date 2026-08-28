export interface KnowledgeFact {
  id: string;
  entityId: string;
  predicate: string;
  value: string;
  sourceRef?: string;
  observedAt: string;
  validFrom?: string;
  validUntil?: string;
  supersedes?: string;
  aliases?: string[];
  sensitivity?: string;
  indexSensitivity?: string;
  backlinks?: string[];
}

export type ClaimRelationship = 'DUPLICATE' | 'RELATED' | 'CONTRADICTORY' | 'DISTINCT';

export type TemporalQueryResult =
  | { status: 'resolved-current-fact'; fact: KnowledgeFact }
  | { status: 'historical-facts'; facts: KnowledgeFact[] }
  | { status: 'no-fact' }
  | { status: 'unresolved-entity-identity'; requestedEntityId: string }
  | { status: 'sensitivity-mismatch'; factIds: string[]; requestedIndexSensitivity: string }
  | { status: 'unresolved-overlapping-conflict'; facts: KnowledgeFact[] };

export interface BrainFinding {
  kind:
    | 'duplicate'
    | 'orphan'
    | 'missing-provenance'
    | 'superseded-current'
    | 'temporal-contradiction'
    | 'alias-collision'
    | 'stale-entity'
    | 'missing-source-link'
    | 'sensitivity-index-mismatch';
  ids: string[];
  repair: 'safe-deterministic' | 'semantic-candidate';
  detail: string;
}

const normalized = (value: string): string =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu, ' ');

const time = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function resolveEntityId(facts: KnowledgeFact[], identity: string): string | undefined {
  const needle = normalized(identity);
  const matches = new Set(
    facts
      .filter((fact) =>
        [fact.entityId, ...(fact.aliases ?? [])].some(
          (candidate) => normalized(candidate) === needle,
        ),
      )
      .map((fact) => fact.entityId),
  );
  return matches.size === 1 ? [...matches][0] : undefined;
}

export function classifyClaims(a: KnowledgeFact, b: KnowledgeFact): ClaimRelationship {
  if (a.entityId !== b.entityId) return 'DISTINCT';
  if (normalized(a.predicate) !== normalized(b.predicate)) return 'RELATED';
  if (normalized(a.value) === normalized(b.value)) return 'DUPLICATE';
  return intervalsOverlap(a, b) ? 'CONTRADICTORY' : 'RELATED';
}

function intervalsOverlap(a: KnowledgeFact, b: KnowledgeFact): boolean {
  const aStart = time(a.validFrom) ?? Number.NEGATIVE_INFINITY;
  const bStart = time(b.validFrom) ?? Number.NEGATIVE_INFINITY;
  const aEnd = time(a.validUntil) ?? Number.POSITIVE_INFINITY;
  const bEnd = time(b.validUntil) ?? Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}

export function factsValidAt(facts: KnowledgeFact[], at: string): KnowledgeFact[] {
  const target = time(at);
  if (target === undefined) return [];
  const superseded = new Set(
    facts
      .filter((fact) => {
        // An undated successor is evidence of supersession, but cannot erase
        // historical truth at every time. Only a dated transition is usable
        // for a temporal query.
        const start = time(fact.validFrom);
        return start !== undefined && start <= target;
      })
      .map((fact) => fact.supersedes)
      .filter(Boolean),
  );
  return facts.filter((fact) => {
    const start = time(fact.validFrom) ?? Number.NEGATIVE_INFINITY;
    const end = time(fact.validUntil) ?? Number.POSITIVE_INFINITY;
    return start <= target && target < end && !superseded.has(fact.id);
  });
}

export function currentCanonicalFacts(facts: KnowledgeFact[], observedAt: string): KnowledgeFact[] {
  const valid = factsValidAt(facts, observedAt);
  const byKey = new Map<string, KnowledgeFact[]>();
  for (const fact of valid) {
    const key = `${fact.entityId}\u0000${normalized(fact.predicate)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), fact]);
  }
  // Never choose the newest observation when overlapping claims disagree.
  return [...byKey.values()].flatMap((rows) => {
    const values = new Set(rows.map((row) => normalized(row.value)));
    if (values.size > 1) return [];
    return [
      rows.reduce((latest, row) =>
        (time(row.observedAt) ?? 0) > (time(latest.observedAt) ?? 0) ? row : latest,
      ),
    ];
  });
}

export function queryTemporalFacts(
  facts: KnowledgeFact[],
  input: {
    entityId: string;
    predicate: string;
    at: string;
    indexSensitivity: string;
    current?: boolean;
  },
): TemporalQueryResult {
  const canonicalEntityId = resolveEntityId(facts, input.entityId);
  if (!canonicalEntityId) {
    return { status: 'unresolved-entity-identity', requestedEntityId: input.entityId };
  }
  const scoped = facts.filter(
    (fact) =>
      resolveEntityId(facts, fact.entityId) === canonicalEntityId &&
      normalized(fact.predicate) === normalized(input.predicate),
  );
  const valid = factsValidAt(scoped, input.at);
  if (valid.length === 0) return { status: 'no-fact' };
  const sensitivityMismatch = valid.filter(
    (fact) =>
      !sensitivityCompatible(fact.sensitivity, fact.indexSensitivity) ||
      !sensitivityCompatible(fact.sensitivity, input.indexSensitivity) ||
      !sensitivityCompatible(input.indexSensitivity, fact.indexSensitivity),
  );
  if (sensitivityMismatch.length > 0) {
    return {
      status: 'sensitivity-mismatch',
      factIds: sensitivityMismatch.map((fact) => fact.id),
      requestedIndexSensitivity: input.indexSensitivity,
    };
  }
  const values = new Set(valid.map((fact) => normalized(fact.value)));
  if (values.size > 1) return { status: 'unresolved-overlapping-conflict', facts: valid };
  if (input.current === false) return { status: 'historical-facts', facts: valid };
  const fact = valid.reduce((latest, row) =>
    (time(row.observedAt) ?? 0) > (time(latest.observedAt) ?? 0) ? row : latest,
  );
  return { status: 'resolved-current-fact', fact };
}

export function inspectBrain(
  facts: KnowledgeFact[],
  options: { now: string; staleAfterMs?: number } = { now: new Date().toISOString() },
): BrainFinding[] {
  const findings: BrainFinding[] = [];
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const aliases = new Map<string, Set<string>>();
  const staleAfter = options.staleAfterMs ?? 365 * 24 * 60 * 60 * 1000;
  const now = time(options.now) ?? Date.now();

  for (const fact of facts) {
    if (!fact.sourceRef)
      findings.push({
        kind: 'missing-provenance',
        ids: [fact.id],
        repair: 'semantic-candidate',
        detail: 'Fact has no source reference; qualification requires evidence.',
      });
    if (fact.sourceRef && !fact.backlinks?.includes(fact.sourceRef))
      findings.push({
        kind: 'missing-source-link',
        ids: [fact.id],
        repair: 'safe-deterministic',
        detail: 'Add the existing source reference as a backlink.',
      });
    if (!sensitivityCompatible(fact.sensitivity, fact.indexSensitivity))
      findings.push({
        kind: 'sensitivity-index-mismatch',
        ids: [fact.id],
        repair: 'safe-deterministic',
        detail: 'Index sensitivity must be at least as restrictive as the source fact.',
      });
    if (now - (time(fact.observedAt) ?? now) > staleAfter)
      findings.push({
        kind: 'stale-entity',
        ids: [fact.id],
        repair: 'semantic-candidate',
        detail:
          'Observation exceeds the configured freshness interval; re-observe before changing truth.',
      });
    if ((fact.backlinks ?? []).some((id) => !byId.has(id) && id !== fact.sourceRef))
      findings.push({
        kind: 'orphan',
        ids: [fact.id],
        repair: 'semantic-candidate',
        detail: 'A backlink target is absent; do not delete or relink without evidence.',
      });
    for (const alias of [fact.entityId, ...(fact.aliases ?? [])]) {
      const key = normalized(alias);
      const owners = aliases.get(key) ?? new Set<string>();
      owners.add(fact.entityId);
      aliases.set(key, owners);
    }
  }

  for (let index = 0; index < facts.length; index += 1) {
    for (let other = index + 1; other < facts.length; other += 1) {
      const a = facts[index]!;
      const b = facts[other]!;
      const relation = classifyClaims(a, b);
      if (relation === 'DUPLICATE')
        findings.push({
          kind: 'duplicate',
          ids: [a.id, b.id],
          repair: 'safe-deterministic',
          detail: 'Equivalent scoped claims can be linked without deleting either source.',
        });
      if (relation === 'CONTRADICTORY')
        findings.push({
          kind: 'temporal-contradiction',
          ids: [a.id, b.id],
          repair: 'semantic-candidate',
          detail:
            'Overlapping valid intervals carry different values; human or evidence-qualified resolution is required.',
        });
    }
  }

  for (const fact of facts.filter((row) => row.supersedes && byId.has(row.supersedes))) {
    const prior = byId.get(fact.supersedes!)!;
    if (!prior.validUntil)
      findings.push({
        kind: 'superseded-current',
        ids: [prior.id, fact.id],
        repair: 'safe-deterministic',
        detail: 'Close the superseded fact at the successor valid-from time when present.',
      });
  }
  for (const [alias, owners] of aliases)
    if (owners.size > 1)
      findings.push({
        kind: 'alias-collision',
        ids: [...owners],
        repair: 'semantic-candidate',
        detail: `Alias ${alias} maps to multiple canonical entities.`,
      });
  return findings;
}

const SENSITIVITY = ['public', 'internal', 'confidential', 'secret'] as const;
function sensitivityCompatible(source: string | undefined, index: string | undefined): boolean {
  const sourceRank = SENSITIVITY.indexOf(source as (typeof SENSITIVITY)[number]);
  const indexRank = SENSITIVITY.indexOf(index as (typeof SENSITIVITY)[number]);
  return sourceRank >= 0 && indexRank >= sourceRank;
}
