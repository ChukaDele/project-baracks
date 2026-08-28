import { describe, expect, it } from 'vitest';
import {
  classifyClaims,
  currentCanonicalFacts,
  factsValidAt,
  inspectBrain,
  queryTemporalFacts,
  resolveEntityId,
  type KnowledgeFact,
} from '../src/knowledge/semantics.js';

const fact = (overrides: Partial<KnowledgeFact>): KnowledgeFact => ({
  id: 'a',
  entityId: 'major',
  predicate: 'status',
  value: 'alpha',
  observedAt: '2026-01-01T00:00:00Z',
  sourceRef: 'source:a',
  backlinks: ['source:a'],
  sensitivity: 'internal',
  indexSensitivity: 'internal',
  ...overrides,
});

describe('knowledge semantics', () => {
  it('resolves only unambiguous canonical aliases', () => {
    expect(resolveEntityId([fact({ aliases: ['Major AI'] })], ' major  ai ')).toBe('major');
    expect(
      resolveEntityId(
        [
          fact({ entityId: 'one', aliases: ['shared'] }),
          fact({ id: 'b', entityId: 'two', aliases: ['shared'] }),
        ],
        'shared',
      ),
    ).toBeUndefined();
  });

  it('distinguishes duplicate, related, contradictory and distinct claims', () => {
    const base = fact({ validFrom: '2026-01-01', validUntil: '2026-03-01' });
    expect(classifyClaims(base, fact({ id: 'b', validFrom: '2026-01-01', value: 'ALPHA' }))).toBe(
      'DUPLICATE',
    );
    expect(classifyClaims(base, fact({ id: 'b', value: 'beta', validFrom: '2026-02-01' }))).toBe(
      'CONTRADICTORY',
    );
    expect(classifyClaims(base, fact({ id: 'b', value: 'beta', validFrom: '2026-03-01' }))).toBe(
      'RELATED',
    );
    expect(classifyClaims(base, fact({ id: 'b', entityId: 'other' }))).toBe('DISTINCT');
  });

  it('selects time-qualified facts and honors explicit supersession', () => {
    const prior = fact({ validFrom: '2026-01-01' });
    const next = fact({
      id: 'b',
      value: 'beta',
      observedAt: '2026-02-02',
      validFrom: '2026-02-01',
      supersedes: 'a',
    });
    expect(factsValidAt([prior, next], '2026-01-10').map((row) => row.id)).toEqual(['a']);
    expect(factsValidAt([prior, next], '2026-02-10').map((row) => row.id)).toEqual(['b']);
    expect(currentCanonicalFacts([prior, next], '2026-02-10')).toEqual([next]);
  });

  it('returns explicit temporal states and never selects the newest contradiction', () => {
    const rows = [
      fact({ validFrom: '2026-01-01', value: 'alpha' }),
      fact({ id: 'b', validFrom: '2026-02-01', value: 'beta', observedAt: '2026-03-01' }),
    ];
    expect(
      queryTemporalFacts(rows, {
        entityId: 'major',
        predicate: 'status',
        at: '2026-02-10',
        indexSensitivity: 'internal',
      }),
    ).toMatchObject({
      status: 'unresolved-overlapping-conflict',
    });
    expect(currentCanonicalFacts(rows, '2026-02-10')).toEqual([]);
    expect(
      queryTemporalFacts([], {
        entityId: 'major',
        predicate: 'status',
        at: '2026-02-10',
        indexSensitivity: 'internal',
      }),
    ).toEqual({ status: 'unresolved-entity-identity', requestedEntityId: 'major' });
    expect(
      queryTemporalFacts([rows[0]!], {
        entityId: 'major',
        predicate: 'status',
        at: '2026-01-10',
        indexSensitivity: 'internal',
        current: false,
      }),
    ).toMatchObject({ status: 'historical-facts' });
  });

  it('canonicalizes temporal aliases and fails closed on sensitivity mismatches', () => {
    const row = fact({ aliases: ['Major AI'], validFrom: '2026-01-01' });
    expect(
      queryTemporalFacts([row], {
        entityId: ' major  ai ',
        predicate: 'STATUS',
        at: '2026-02-01',
        indexSensitivity: 'internal',
      }),
    ).toMatchObject({ status: 'resolved-current-fact', fact: { id: 'a' } });
    expect(
      queryTemporalFacts([row], {
        entityId: 'Major AI',
        predicate: 'status',
        at: '2026-02-01',
        indexSensitivity: 'public',
      }),
    ).toEqual({
      status: 'sensitivity-mismatch',
      factIds: ['a'],
      requestedIndexSensitivity: 'public',
    });
    const { sensitivity: _sensitivity, ...missingSensitivity } = row;
    expect(
      queryTemporalFacts([missingSensitivity], {
        entityId: 'major',
        predicate: 'status',
        at: '2026-02-01',
        indexSensitivity: 'internal',
      }),
    ).toMatchObject({ status: 'sensitivity-mismatch' });
  });

  it('preserves prior history when supersession has no effective date', () => {
    const prior = fact({ validFrom: '2020-01-01' });
    const undated = fact({ id: 'b', value: 'beta', supersedes: 'a', observedAt: '2026-01-01' });
    expect(factsValidAt([prior, undated], '2021-01-01').map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('reports deterministic repairs separately from semantic candidates', () => {
    const rows = [
      fact({ backlinks: [], validFrom: '2026-01-01' }),
      fact({
        id: 'b',
        value: 'beta',
        validFrom: '2026-01-02',
        supersedes: 'a',
        aliases: ['Major'],
      }),
    ];
    const findings = inspectBrain(rows, {
      now: '2026-02-01',
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'missing-source-link', repair: 'safe-deterministic' }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'temporal-contradiction', repair: 'semantic-candidate' }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'superseded-current', repair: 'safe-deterministic' }),
    );
  });

  it('has a classified fixture for every brain-maintenance finding', () => {
    const rows = [
      {
        id: 'a',
        entityId: 'major',
        predicate: 'status',
        value: 'alpha',
        backlinks: ['missing'],
        aliases: ['shared'],
        sensitivity: 'secret',
        indexSensitivity: 'public',
        observedAt: '2020-01-01',
      },
      fact({ id: 'b', entityId: 'other', aliases: ['shared'], backlinks: [] }),
      fact({ id: 'c', value: 'alpha' }),
      fact({ id: 'd', value: 'beta', validFrom: '2025-01-01', supersedes: 'c' }),
    ];
    const kinds = new Set(
      inspectBrain(rows, { now: '2026-02-01', staleAfterMs: 1 }).map((finding) => finding.kind),
    );
    expect(kinds).toEqual(
      new Set([
        'duplicate',
        'orphan',
        'missing-provenance',
        'superseded-current',
        'temporal-contradiction',
        'alias-collision',
        'stale-entity',
        'missing-source-link',
        'sensitivity-index-mismatch',
      ]),
    );
  });
});
