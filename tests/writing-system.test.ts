import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discloseSkills, resolveSkills } from '../src/skills/resolver.js';
import { diagnoseProse } from '../src/writing/diagnostics.js';
import { evaluateWriting } from '../src/writing/evaluator.js';
import { resolveWritingRoute } from '../src/writing/routing.js';
import {
  inspectWritingDraft,
  parseWritingGateEvidence,
  writingDraftDigest,
  writingSourcesDigest,
} from '../src/writing/runtime.js';
import { captureAcceptedWritingEdit } from '../src/writing/learning.js';
import { observeDetectors } from '../src/writing/detector-observations.js';
import { runLocalVale, type LocalDiagnosticExecutor } from '../src/writing/vale.js';
import {
  buildVoiceFingerprint,
  compareVoiceFingerprint,
} from '../src/writing/voice-fingerprint.js';

const routeFixtures = JSON.parse(
  readFileSync(join(process.cwd(), 'evals/writing-regression/routes.json'), 'utf8'),
) as {
  fixtures: Array<{ prompt: string; genre: string; required: string[]; forbidden: string[] }>;
  negativeFixtures: Array<{ id: string; prompt: string }>;
};
const priorMajorHome = process.env.MAJOR_HOME;
const testMajorHome = mkdtempSync(join(tmpdir(), 'major-writing-system-'));
beforeAll(() => {
  process.env.MAJOR_HOME = testMajorHome;
});
afterAll(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  rmSync(testMajorHome, { recursive: true, force: true });
});

describe('canonical writing system', () => {
  it.each(routeFixtures.fixtures)('routes unnamed $genre prompt: $prompt', (fixture) => {
    const route = resolveWritingRoute(fixture.prompt)!;
    expect(route.genre).toBe(fixture.genre);
    expect(route.skills).toEqual(expect.arrayContaining(fixture.required));
    for (const id of fixture.forbidden) expect(route.skills).not.toContain(id);
    const resolved = resolveSkills({ task: fixture.prompt });
    expect(resolved.receipt.writing?.lifecycle).toBe('RESOLVED_NOT_EXECUTED');
    expect(resolved.skills.map((skill) => skill.id)).toEqual(route.skills);
  });

  it.each(routeFixtures.negativeFixtures)('does not route negative fixture $id', (fixture) => {
    expect(resolveWritingRoute(fixture.prompt)).toBeUndefined();
    expect(
      resolveSkills({ task: fixture.prompt, limit: 12 }).skills.map((skill) => skill.id),
    ).not.toContain('writing-os');
  });

  it('does not route non-writing or code-only work through Writing OS', () => {
    expect(resolveWritingRoute('Fix the TypeScript resolver bug.')).toBeUndefined();
    expect(
      resolveSkills({ task: 'Fix the TypeScript resolver bug.' }).skills.map((s) => s.id),
    ).not.toContain('writing-os');
    expect(resolveWritingRoute('Write a TypeScript function to parse JSON.')).toBeUndefined();
    expect(resolveWritingRoute('Rewrite this SQL query for speed.')).toBeUndefined();
    expect(resolveWritingRoute('Write a press release about our API launch.')).toBeDefined();
    expect(
      resolveWritingRoute('Compose a product description for the developer API.'),
    ).toBeDefined();
  });

  it('routes simple replies transactionally and public web messaging as high-stakes', () => {
    expect(resolveWritingRoute('write a reply')).toMatchObject({
      genre: 'transactional',
      transactional: true,
      substantive: false,
    });
    expect(
      resolveWritingRoute('draft direct response copy asking readers to subscribe'),
    ).toMatchObject({
      genre: 'direct-response',
      transactional: false,
      skills: expect.arrayContaining(['direct-response-writing']),
    });
    expect(resolveWritingRoute('rewrite this reply')).toMatchObject({
      transactional: true,
      substantive: false,
      risk: 'routine',
    });
    expect(resolveWritingRoute('write the public landing page')).toMatchObject({
      genre: 'brand',
      risk: 'high-stakes',
      pipelineStages: expect.arrayContaining([
        'research-evidence',
        'independent-red-team-when-required',
      ]),
    });
  });

  it('keeps a casual summary of academic material on the ordinary writing route', () => {
    const route = resolveWritingRoute('Summarize this academic abstract for a casual note.');
    expect(route).toMatchObject({ genre: 'general', risk: 'routine' });
    expect(route?.skills).not.toContain('academic-verify');
  });

  it('discloses the selected Writing OS bodies, not only registry metadata', () => {
    const disclosure = discloseSkills({
      task: 'write the public homepage for our product',
      bodyBytes: 100_000,
      perBodyBytes: 20_000,
    });
    const bodies = disclosure.bodies.map((body) => body.id);
    expect(bodies).toEqual(expect.arrayContaining(['writing-os', 'brand-strategy', 'prose-craft']));
    expect(disclosure.bodies.find((body) => body.id === 'writing-os')?.content).toContain(
      'For every substantive writing request',
    );
  });

  it('preserves non-writing UI routing and does not mistake correction language for writing', () => {
    const uiTask = 'Make this website Awwwards-level without losing conversion clarity';
    expect(resolveWritingRoute(uiTask)).toBeUndefined();
    expect(resolveSkills({ task: uiTask, limit: 12 }).skills.map((s) => s.id)).toContain(
      'design-direction-and-taste',
    );
    const correction =
      'Stop doing this across my projects and make sure Major learns the correction.';
    expect(resolveWritingRoute(correction)).toBeUndefined();
    expect(resolveSkills({ task: correction, limit: 12 }).skills.map((s) => s.id)).toContain(
      'learning-capture',
    );
  });

  it('selects exactly the canonical route and keeps voice out of technical SOPs', () => {
    const task = 'make this SOP clearer';
    const route = resolveWritingRoute(task)!;
    expect(route.skills).not.toContain('voice-fingerprint');
    expect(resolveSkills({ task }).skills.map((skill) => skill.id)).toEqual(route.skills);
  });

  it('does not let a caller limit truncate a mandatory automatic writing route', () => {
    const task = 'write a LinkedIn post about these notes';
    const route = resolveWritingRoute(task)!;
    expect(resolveSkills({ task, limit: 2 }).skills.map((skill) => skill.id)).toEqual(route.skills);
  });

  it('keeps contextual natural-writing diagnostics out of code and quotes', () => {
    const report = diagnoseProse(
      "```ts\nconst tapestry = 'delve';\n```\n> Studies show this.\nRun the command once.",
      'technical',
    );
    expect(report.findings).toEqual([]);
    expect(report.confidence).toBe('low');
    expect(report.exclusions).toEqual({
      fencedCodeBlocks: 1,
      inlineCodeSpans: 0,
      quotedLines: 1,
    });
    expect(report.critic).toMatchObject({ id: 'natural-writing-qa', mode: 'detect-only' });
    expect(report.critic.upstream).toContain('conorbronsdon/avoid-ai-writing');
    expect(report.fleschKincaidGrade).toBeTypeOf('number');
  });

  it('attaches profile, severity, rule, and suppression metadata to contextual findings', () => {
    const finding = diagnoseProse('Studies show this always works.', 'academic').findings[0];
    expect(finding).toMatchObject({
      ruleId: 'major.clarity.vague-attribution',
      severity: 'error',
      profile: 'academic',
      suppression: { eligible: false },
    });
  });

  it('reports dimensions separately and never treats low pattern count as substantive quality', () => {
    const result = evaluateWriting({
      draft: 'Everything always works.',
      brief: 'write a sourced academic essay',
      genre: 'academic',
    });
    expect(result.dimensions.naturalness).toEqual([]);
    expect(result.dimensions['claim-strength']?.[0]?.severity).toBe('error');
    expect(result.dimensions['source-fidelity']?.[0]?.severity).toBe('error');
    expect(result.dimensions['factual-preservation']?.[0]).toMatchObject({
      dimension: 'factual-preservation',
      severity: 'error',
    });
    expect(result.dimensionPass['source-fidelity']).toBe(false);
    expect(result.dimensionPass['factual-preservation']).toBe(false);
    expect(result.evaluatorRole).toBe('critic-only');
    expect(result.aggregation).toBe('none');
    expect(result.pass).toBe(false);
  });

  it('requires a measurable corpus and returns versioned deviations', () => {
    expect(() => buildVoiceFingerprint('tiny', ['Too short.'])).toThrow(
      /at least 3 approved samples and 300 words/,
    );
    const sample =
      'I test the claim against a concrete case. The result matters because the reader can act on it. ';
    const profile = buildVoiceFingerprint('personal-v1', [
      sample.repeat(8),
      sample.repeat(8),
      sample.repeat(8),
    ]);
    expect(profile).toMatchObject({ schemaVersion: 2, profileId: 'personal-v1', sampleCount: 3 });
    expect(profile.featureEvidence.sentenceLengthMean).toMatchObject({ unit: 'words' });
    expect(profile.features).toEqual(
      expect.objectContaining({
        sentenceLengthVariance: expect.any(Number),
        functionWordRate: expect.any(Number),
        transitionRate: expect.any(Number),
        abstractWordRate: expect.any(Number),
        conjunctionOpeningRate: expect.any(Number),
      }),
    );
    expect(profile.constraints).toContain('no-author-or-ai-labels');
    const comparison = compareVoiceFingerprint(profile, 'A short candidate.');
    expect(comparison).toMatchObject({
      schemaVersion: 2,
      profileId: 'personal-v1',
      profileCorpusSha256: profile.corpusSha256,
      insufficientEvidence: true,
    });
    expect(comparison.deviations.sentenceLengthMean).toEqual(
      expect.objectContaining({ expected: expect.any(Number), actual: expect.any(Number) }),
    );
  });

  it('runs an optional local Vale seam and parses rule, severity, and span evidence', () => {
    const requests: Parameters<LocalDiagnosticExecutor>[0][] = [];
    const executor: LocalDiagnosticExecutor = (request) => {
      requests.push(request);
      if (request.operation === 'version') return { status: 0, stdout: 'Vale 3.9.0\n', stderr: '' };
      return {
        status: 0,
        stdout: JSON.stringify({
          stdin: [
            {
              Check: 'Major.Clarity.VagueAttribution',
              Severity: 'error',
              Message: 'Name the source.',
              Line: 1,
              Span: [1, 12],
            },
          ],
        }),
        stderr: '',
      };
    };
    const report = runLocalVale({ text: 'Studies show this.', profile: 'academic' }, executor);
    expect(report).toMatchObject({ state: 'available', version: 'Vale 3.9.0', passed: false });
    expect(report.configPath).toMatch(/config\/vale\/profiles\/academic\.ini$/);
    expect(requests).toEqual([
      { operation: 'version' },
      { operation: 'lint', profile: 'academic', stdin: 'Studies show this.' },
    ]);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'Major.Clarity.VagueAttribution',
      severity: 'error',
      profile: 'academic',
      evidence: 'Studies show',
      suppression: { eligible: false },
      line: 1,
      span: [1, 12],
    });
    expect(
      runLocalVale({ text: 'Plain prose.' }, () => ({
        status: null,
        stdout: '',
        stderr: '',
        error: { code: 'trusted-vale-unavailable', message: 'Pinned Vale is absent' },
      })),
    ).toMatchObject({
      state: 'unavailable',
      passed: false,
    });
  });

  it('keeps detector observations diagnostic and exposes disagreement', () => {
    const report = observeDetectors([
      {
        detector: 'one',
        version: '1',
        score: 0.8,
        genre: 'report',
        model: 'm1',
        observedAt: '2026-08-30',
        limitations: ['short-text variance'],
      },
      {
        detector: 'two',
        version: '2',
        score: 0.2,
        genre: 'report',
        model: 'm2',
        observedAt: '2026-08-30',
        limitations: ['domain shift'],
      },
    ]);
    expect(report).toMatchObject({
      agreement: 'disagreement',
      qualityGate: false,
      evasionTrigger: false,
    });
    expect(() =>
      observeDetectors(
        Array.from({ length: 33 }, (_, index) => ({
          detector: `detector-${index}`,
          version: '1',
          score: 0.5,
          genre: 'report',
          model: 'model',
          observedAt: '2026-08-30',
          limitations: ['diagnostic only'],
        })),
      ),
    ).toThrow(/bounded limit/);
    expect(() =>
      observeDetectors([
        {
          detector: 'one',
          version: '1',
          score: 0.5,
          genre: 'report',
          model: 'model',
          observedAt: '2026-08-30',
          limitations: ['x'.repeat(1_001)],
          authority: true,
        } as never,
      ]),
    ).toThrow(/unknown fields/);
  });

  it('requires trace evidence and preserves technical qualifications and procedure text', () => {
    const protectedStatement = 'Only restart the pump after pressure reaches zero.';
    const result = evaluateWriting({
      draft: protectedStatement,
      brief: 'make this SOP clearer',
      genre: 'technical',
      sources: [{ id: 'manual-1', content: protectedStatement }],
      claimTrace: [
        {
          claim: protectedStatement,
          sourceId: 'manual-1',
          sourceExcerpt: protectedStatement,
          supported: true,
        },
      ],
      protectedStatements: [protectedStatement],
    });
    expect(result.claimTrace.state).toBe('supported');
    expect(result.factualPreservation.state).toBe('preserved');
    expect(result.dimensions['source-fidelity']).toEqual([]);
    expect(result.dimensions['factual-preservation']).toEqual([]);
    expect(
      evaluateWriting({
        draft: protectedStatement,
        brief: 'make this SOP clearer',
        genre: 'technical',
        claimTrace: [
          {
            claim: protectedStatement,
            sourceId: 'manual-1',
            sourceExcerpt: protectedStatement,
            supported: true,
          },
        ],
        protectedStatements: [protectedStatement],
      }).claimTrace.state,
    ).toBe('unsupported');
    const unknownSource = evaluateWriting({
      draft: protectedStatement,
      brief: 'make this SOP clearer',
      genre: 'technical',
      sources: [{ id: 'manual-1', content: protectedStatement }],
      claimTrace: [
        {
          claim: protectedStatement,
          sourceId: 'manual-2',
          sourceExcerpt: protectedStatement,
          supported: true,
        },
      ],
      protectedStatements: [protectedStatement],
    });
    expect(unknownSource.claimTrace.state).toBe('unsupported');
    expect(unknownSource.dimensions['source-fidelity']).toHaveLength(1);
    expect(unknownSource.dimensions['factual-preservation']).toEqual([]);
    expect(
      evaluateWriting({
        draft: 'Restart the pump.',
        brief: 'make this SOP clearer',
        genre: 'technical',
        sources: [{ id: 'manual-1', content: protectedStatement }],
      }).claimTrace.state,
    ).toBe('missing');
  });

  it('surfaces high-stakes red-team and unavailable lint as explicit lifecycle states', () => {
    const report = inspectWritingDraft({
      task: 'prepare an important client-facing proposal',
      draft: 'The proposal makes one careful claim.',
    });
    expect(report.gates).toContainEqual(
      expect.objectContaining({ gate: 'independent-red-team', state: 'pending' }),
    );
    expect(report.gates.find((gate) => gate.gate === 'prose-lint')?.state).toMatch(
      /passed|degraded/,
    );
    expect(report.finalState).not.toBe('passed');
    expect(report.gates).toContainEqual(
      expect.objectContaining({ gate: 'final-verification', state: 'failed' }),
    );
  });

  it('rejects caller-provided red-team authority from writing evidence', () => {
    expect(
      parseWritingGateEvidence({
        redTeam: {
          draftSha256: '0'.repeat(64),
          reviewerRunId: 'writer-1',
          draftAuthorRunId: 'writer-2',
          findings: [],
        },
      }),
    ).toBeUndefined();
  });

  it('binds red-team and final verification to trusted exact-draft authority', () => {
    const draft = 'The proposal makes one careful claim.';
    const report = inspectWritingDraft({
      task: 'prepare an important client-facing proposal',
      draft,
      authority: {
        redTeam: {
          draftSha256: writingDraftDigest(draft),
          receiptId: 'receipt-1',
          verdict: 'fail',
        },
      },
    });
    expect(report.gates).toContainEqual(
      expect.objectContaining({ gate: 'independent-red-team', state: 'failed' }),
    );
    expect(report.gates).toContainEqual(
      expect.objectContaining({ gate: 'final-verification', state: 'failed' }),
    );
  });

  it('fails Vale closed on invalid JSON through the bounded request seam', () => {
    const requests: Parameters<LocalDiagnosticExecutor>[0][] = [];
    const report = runLocalVale({ text: 'Plain prose.', profile: 'technical' }, (request) => {
      requests.push(request);
      return request.operation === 'version'
        ? { status: 0, stdout: 'Vale 3.9.0', stderr: '' }
        : { status: 0, stdout: '{', stderr: '' };
    });
    expect(report).toMatchObject({ state: 'degraded', passed: false });
    expect(requests).toEqual([
      { operation: 'version' },
      { operation: 'lint', profile: 'technical', stdin: 'Plain prose.' },
    ]);
  });

  it('validates source excerpts against bounded supplied content and preserves only sourced text', () => {
    const statement = 'Only restart the pump after pressure reaches zero.';
    const sources = [{ id: 'manual-1', content: `Safety: ${statement}` }];
    const draftSha256 = writingDraftDigest(statement);
    const evidence = {
      sourcePreservation: {
        draftSha256,
        sourcesSha256: writingSourcesDigest(sources.map(({ id, content }) => `${id}\0${content}`)),
        sources,
        claimTrace: [{ claim: statement, sourceId: 'manual-1', sourceExcerpt: statement }],
        protectedStatements: [statement],
      },
    };
    const valid = inspectWritingDraft({
      task: 'make this SOP clearer',
      draft: statement,
      evidence,
      authority: {
        sourceCoverage: {
          receiptId: 'coverage-receipt',
          draftSha256,
          sourcesSha256: evidence.sourcePreservation.sourcesSha256,
          verdict: 'pass',
        },
      },
    });
    expect(valid.gates).toContainEqual(
      expect.objectContaining({ gate: 'source-claim-check', state: 'passed' }),
    );
    const mismatch = inspectWritingDraft({
      task: 'make this SOP clearer',
      draft: statement,
      evidence: {
        sourcePreservation: {
          ...evidence.sourcePreservation,
          claimTrace: [
            { claim: statement, sourceId: 'manual-1', sourceExcerpt: 'Invented excerpt.' },
          ],
        },
      },
    });
    expect(mismatch.gates).toContainEqual(
      expect.objectContaining({ gate: 'source-claim-check', state: 'failed' }),
    );
    expect(valid.gates.find(({ gate }) => gate === 'source-claim-check')?.detail).toContain(
      'bounded claim trace',
    );
  });

  it('bounds source evidence payloads', () => {
    expect(
      parseWritingGateEvidence({
        sourcePreservation: {
          draftSha256: 'a'.repeat(64),
          sourcesSha256: 'b'.repeat(64),
          sources: [{ id: 'source', content: 'x'.repeat(100_001) }],
          claimTrace: [],
          protectedStatements: [],
        },
      }),
    ).toBeUndefined();
    expect(
      parseWritingGateEvidence({
        revision: {
          beforeDraftSha256: 'a'.repeat(64),
          afterDraftSha256: 'b'.repeat(64),
          addressedFindingIds: ['x'.repeat(501)],
        },
      }),
    ).toBeUndefined();
    expect(
      parseWritingGateEvidence({
        revision: {
          beforeDraftSha256: 'a'.repeat(64),
          afterDraftSha256: 'b'.repeat(64),
          addressedFindingIds: ['finding-1'],
          reviewerApproved: true,
        },
      }),
    ).toBeUndefined();
    expect(
      parseWritingGateEvidence({
        sourcePreservation: {
          draftSha256: 'a'.repeat(64),
          sourcesSha256: 'b'.repeat(64),
          sources: [{ id: 'source', content: 'text', complete: true }],
          claimTrace: [],
          protectedStatements: [],
        },
      }),
    ).toBeUndefined();
  });

  it('captures accepted edits as lifecycle candidates without direct global policy', () => {
    const oneOff = captureAcceptedWritingEdit({
      summary: 'Keep this sentence for this deliverable only.',
      evidence: 'User restored the wording.',
      classification: 'one-off',
      project: 'writing-test-project',
      accepted: true,
    });
    const proposedGlobal = captureAcceptedWritingEdit({
      summary: 'Prefer concrete openings.',
      evidence: 'User accepted the edit.',
      classification: 'global',
      project: 'writing-test-project',
      accepted: true,
    });
    expect(oneOff).toMatchObject({ scope: 'undecided', status: 'candidate' });
    expect(proposedGlobal).toMatchObject({ scope: 'project', status: 'candidate' });
    const unrelatedGlobal = captureAcceptedWritingEdit({
      summary: 'Prefer direct conclusions.',
      evidence: 'User accepted a different edit.',
      classification: 'global',
      project: 'writing-test-project',
      accepted: true,
    });
    expect(unrelatedGlobal.id).not.toBe(proposedGlobal.id);
    expect(unrelatedGlobal.occurrences).toBe(1);
  });
});
