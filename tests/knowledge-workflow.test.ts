import { describe, expect, it, vi } from 'vitest';
import { ingestKnowledge, type KnowledgeInputRecord } from '../src/knowledge/workflow.js';
import { runKnowledgeCli } from '../src/knowledge/cli.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  academicEvidenceStrength,
  orderIdeaLineage,
  strategicReadingFindings,
  validateConceptSynthesis,
  verifyAcademicEvidence,
  validateCompendium,
  type IdeaLineageEvent,
  type StrategicReadingOutput,
  type ConceptSynthesisEdge,
} from '../src/knowledge/contracts.js';
import { validateSkillOptimization } from '../src/skills/optimizer-validation.js';

const row = (overrides: Partial<KnowledgeInputRecord> = {}): KnowledgeInputRecord => ({
  id: 'claim-1',
  entityId: 'major',
  predicate: 'status',
  value: 'active',
  kind: 'source-claim',
  sourceLocator: 'https://example.test/source',
  retrievalId: 'retrieval-1',
  observedAt: '2026-08-28T00:00:00Z',
  sourceRef: 'source-1',
  notable: true,
  aliases: ['Major AI'],
  ...overrides,
});

describe('Major-native knowledge workflow', () => {
  it('dispatches bounded JSON through the production knowledge CLI and typed boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'major-knowledge-cli-'));
    try {
      const input = join(root, 'input.json');
      writeFileSync(
        input,
        JSON.stringify({
          records: Array.from({ length: 101 }, (_, id) =>
            row({ id: `r-${id}`, predicate: `p-${id}` }),
          ),
        }),
      );
      const captureMeaning = vi.fn();
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await expect(
        runKnowledgeCli(['knowledge', 'ingest', '--input', input], () => ({ captureMeaning })),
      ).resolves.toBe(true);
      expect(captureMeaning).toHaveBeenCalledTimes(100);
      expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string)).toMatchObject({
        accepted: expect.any(Array),
        truncated: 1,
      });
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('executes ingest through an injected existing learning/GBrain boundary with provenance and bounded receipts', () => {
    const captureMeaning = vi.fn();
    const receipt = ingestKnowledge(
      [
        row(),
        row({ id: 'duplicate' }),
        row({ id: 'noise', predicate: 'color', notable: false }),
        row({
          id: 'conclusion',
          predicate: 'direction',
          value: 'ship',
          kind: 'major-conclusion',
          retrievalId: 'retrieval-2',
        }),
      ],
      [],
      { captureMeaning },
      3,
    );
    expect(receipt.accepted.map((item) => item.id)).toEqual(['claim-1']);
    expect(receipt.rejected.map((item) => item.reason)).toEqual(['duplicate', 'not-notable']);
    expect(receipt.truncated).toBe(1);
    expect(captureMeaning).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'source-claim',
        sourceLocator: 'https://example.test/source',
        retrievalId: 'retrieval-1',
      }),
    );
  });

  it('fails closed on alias collisions', () => {
    const captureMeaning = vi.fn();
    const receipt = ingestKnowledge(
      [row({ entityId: 'shared' })],
      [
        {
          id: 'a',
          entityId: 'one',
          predicate: 'name',
          value: 'x',
          observedAt: '2026-01-01',
          aliases: ['shared'],
        },
        {
          id: 'b',
          entityId: 'two',
          predicate: 'name',
          value: 'y',
          observedAt: '2026-01-01',
          aliases: ['shared'],
        },
      ],
      { captureMeaning },
    );
    expect(receipt.unresolved[0]?.reason).toBe('ambiguous-or-unestablished-entity-alias');
    expect(captureMeaning).not.toHaveBeenCalled();
  });

  it('compares every same-entity fact before accepting related meaning', () => {
    const captureMeaning = vi.fn();
    const receipt = ingestKnowledge(
      [row({ value: 'beta', validFrom: '2026-02-01' })],
      [
        row({ id: 'related', predicate: 'owner', value: 'team' }),
        row({ id: 'conflict', value: 'alpha', validFrom: '2026-01-01' }),
      ],
      { captureMeaning },
    );
    expect(receipt.unresolved[0]).toMatchObject({ relationship: 'CONTRADICTORY' });
    expect(captureMeaning).not.toHaveBeenCalled();
  });
});

describe('knowledge skill contracts', () => {
  it('produces deterministic findings while keeping reasoning explicit', () => {
    expect(
      strategicReadingFindings({
        mechanisms: [' feedback ', 'feedback'],
        limits: [],
        contradictions: [],
        actions: [],
        indicators: [],
      }),
    ).toMatchObject({ mechanisms: ['feedback'], executionClass: 'reasoning-required' });
    expect(
      orderIdeaLineage([
        { ideaId: 'i', transition: 'introduced', sourceRef: 's', observedAt: 'bad' },
        { ideaId: 'i', transition: 'challenged', sourceRef: 's1', observedAt: '2026-01-01' },
        { ideaId: 'i', transition: 'revived', sourceRef: 's2', observedAt: '2026-01-01' },
      ]),
    ).toMatchObject({
      invalid: [expect.objectContaining({ observedAt: 'bad' })],
      contradictory: [expect.objectContaining({ ideaId: 'i' })],
    });
    expect(
      validateConceptSynthesis([{ from: 'a', to: 'a', relationship: 'supports', sourceRefs: [] }]),
    ).toMatchObject({
      accepted: [],
      findings: expect.arrayContaining(['edge-0-entities-invalid']),
    });
    expect(
      verifyAcademicEvidence({
        sourceCount: 1,
        primary: true,
        replicated: true,
        methodologyPresent: false,
        limitationsPresent: false,
        contradictoryResults: true,
      }),
    ).toMatchObject({
      strength: 'single-source',
      executionClass: 'reasoning-required',
      findings: expect.arrayContaining([
        'replication-unsupported',
        'contradictory-results-unresolved',
      ]),
    });
  });

  it('behaviorally represents strategic reading, lineage and synthesis', () => {
    const reading: StrategicReadingOutput = {
      mechanisms: ['feedback'],
      limits: ['small sample'],
      contradictions: ['A vs B'],
      actions: ['test'],
      indicators: ['retention'],
      executionClass: 'reasoning-required',
    };
    const lineage: IdeaLineageEvent[] = [
      { ideaId: 'i', transition: 'challenged', sourceRef: 's1', observedAt: '2026-01-01' },
      { ideaId: 'i', transition: 'revived', sourceRef: 's2', observedAt: '2026-02-01' },
    ];
    const edges: ConceptSynthesisEdge[] = [
      { from: 'a', to: 'b', relationship: 'minority-alternative', sourceRefs: ['s1'] },
    ];
    expect(reading.limits).toEqual(['small sample']);
    expect(lineage.map((event) => event.transition)).toEqual(['challenged', 'revived']);
    expect(edges[0]?.relationship).toBe('minority-alternative');
  });

  it('validates compendium citation structure and academic evidence strength', () => {
    expect(
      validateCompendium({
        question: 'Q?',
        sources: [{ locator: 's', retrievedAt: '2026-01-01' }],
        claims: [{ text: 'c', sourceLocators: ['s'] }],
        conclusions: [{ text: 'd', basisClaimIndexes: [0] }],
        unresolved: [],
      }),
    ).toEqual([]);
    expect(
      validateCompendium({
        question: 'Q?',
        sources: [],
        claims: [{ text: 'c', sourceLocators: [] }],
        conclusions: [],
        unresolved: [],
      }),
    ).toContain('claim-0-source-invalid');
    expect(
      ['unsupported', 'single-source', 'corroborated', 'primary-replicated'].map((_, index) =>
        academicEvidenceStrength({
          sourceCount: index,
          primary: index === 3,
          replicated: index === 3,
        }),
      ),
    ).toEqual(['unsupported', 'single-source', 'corroborated', 'primary-replicated']);
  });
});

describe('skill optimizer evidence gate', () => {
  const evidence = {
    version: '2.0.0',
    runIds: ['run-1', 'run-2', 'run-3'],
    taskIds: ['task-1', 'task-2', 'task-3'],
    baselineQuality: [100, 101, 99],
    candidateQuality: [110, 111, 109],
    baselineLatencyMs: [100, 101, 99],
    candidateLatencyMs: [90, 91, 89],
    baselineCost: [2, 2, 2],
    candidateCost: [2, 2, 2],
    heldOut: {
      runIds: ['held-out-run'],
      taskIds: ['held-out-task'],
      baselineQuality: [100],
      candidateQuality: [108],
    },
    mutationExists: true,
    materialThreshold: 7,
    rollbackTarget: '1.0.0',
    postActivationFieldOutcome: 'field success',
  };
  it('requires lifecycle evidence and applies the five-percent inconclusive band', () => {
    expect(validateSkillOptimization(evidence).status).toBe('promotable');
    expect(
      validateSkillOptimization({ ...evidence, candidateQuality: [102, 103, 101] }).status,
    ).toBe('inconclusive');
    const { heldOut: _heldOut, postActivationFieldOutcome: _outcome, ...incomplete } = evidence;
    expect(validateSkillOptimization(incomplete).reasons).toEqual(
      expect.arrayContaining([
        'held-out-result-required-for-mutation',
        'post-activation-field-outcome-required',
      ]),
    );
  });

  it('rejects unpaired identities, invalid measurements, and fake held-out reuse', () => {
    expect(validateSkillOptimization({ ...evidence, taskIds: ['task-1'] }).reasons).toContain(
      'comparable-evidence-length-mismatch',
    );
    expect(
      validateSkillOptimization({ ...evidence, baselineLatencyMs: [100, Number.NaN, 99] }).reasons,
    ).toContain('finite-nonnegative-measurements-required');
    expect(
      validateSkillOptimization({
        ...evidence,
        heldOut: {
          runIds: ['run-1'],
          taskIds: ['task-1'],
          baselineQuality: [100],
          candidateQuality: [108],
        },
      }).reasons,
    ).toContain('real-held-out-pairing-required');
  });
});
