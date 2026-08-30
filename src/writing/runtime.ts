import { createHash } from 'node:crypto';
import { diagnoseProse, type ProseDiagnostics } from './diagnostics.js';
import {
  evaluateWriting,
  type ClaimTraceEvidence,
  type WritingEvaluation,
  type WritingSourceEvidence,
} from './evaluator.js';
import { resolveWritingRoute } from './routing.js';
import type { WritingGate, WritingPipelineStage, WritingRoute } from './types.js';
import { runLocalVale, type ValeEvidence } from './vale.js';
import {
  observeDetectors,
  type DetectorObservation,
  type DetectorObservationReport,
} from './detector-observations.js';

export interface WritingGateResult {
  gate: WritingGate;
  state: 'passed' | 'failed' | 'degraded' | 'pending';
  detail: string;
}
export interface WritingRuntimeReport {
  version: 1;
  route: WritingRoute;
  selectedSkills: string[];
  selectionReasons: Record<string, string>;
  gates: WritingGateResult[];
  pipeline: Array<{ stage: WritingPipelineStage; state: 'selected' | 'ran' | 'pending' }>;
  diagnostics: ProseDiagnostics;
  vale: ValeEvidence;
  detectorObservations: DetectorObservationReport;
  evaluation: WritingEvaluation;
  revisionsTriggered: string[];
  finalState: 'passed' | 'failed' | 'degraded';
}

export interface WritingGateEvidence {
  revision?: {
    beforeDraftSha256: string;
    afterDraftSha256: string;
    addressedFindingIds: string[];
  };
  sourcePreservation?: {
    draftSha256: string;
    sourcesSha256: string;
    sources: WritingSourceEvidence[];
    claimTrace: ClaimTraceEvidence[];
    protectedStatements: string[];
  };
}

/** Trusted runtime authority resolved from Major's persisted review receipt.
 * This is deliberately not part of the provider-owned worker report. */
export interface WritingRuntimeAuthority {
  redTeam?: {
    receiptId: string;
    draftSha256: string;
    verdict: 'pass' | 'fail';
  };
}

export function parseWritingGateEvidence(value: unknown): WritingGateEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const hash = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^[a-f0-9]{64}$/u.test(candidate);
  const output: WritingGateEvidence = {};
  if (record.redTeam !== undefined) return undefined;
  if (record.revision !== undefined) {
    if (!record.revision || typeof record.revision !== 'object' || Array.isArray(record.revision))
      return undefined;
    const item = record.revision as Record<string, unknown>;
    if (
      !hash(item.beforeDraftSha256) ||
      !hash(item.afterDraftSha256) ||
      !Array.isArray(item.addressedFindingIds) ||
      !item.addressedFindingIds.every((id) => typeof id === 'string' && id.trim())
    )
      return undefined;
    output.revision = {
      beforeDraftSha256: item.beforeDraftSha256,
      afterDraftSha256: item.afterDraftSha256,
      addressedFindingIds: item.addressedFindingIds.filter(
        (id): id is string => typeof id === 'string',
      ),
    };
  }
  if (record.sourcePreservation !== undefined) {
    if (
      !record.sourcePreservation ||
      typeof record.sourcePreservation !== 'object' ||
      Array.isArray(record.sourcePreservation)
    )
      return undefined;
    const item = record.sourcePreservation as Record<string, unknown>;
    if (!hash(item.draftSha256) || !hash(item.sourcesSha256)) return undefined;
    const sourceInput = Array.isArray(item.sources) ? item.sources : undefined;
    const claimTraceInput = Array.isArray(item.claimTrace) ? item.claimTrace : undefined;
    const protectedInput = Array.isArray(item.protectedStatements)
      ? item.protectedStatements
      : undefined;
    if (
      (sourceInput?.length ?? 0) > 32 ||
      (claimTraceInput?.length ?? 0) > 256 ||
      (protectedInput?.length ?? 0) > 256
    )
      return undefined;
    const sources = sourceInput
      ? sourceInput.flatMap((source): WritingSourceEvidence[] => {
          if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
          const candidate = source as Record<string, unknown>;
          return typeof candidate.id === 'string' &&
            Boolean(candidate.id.trim()) &&
            typeof candidate.content === 'string' &&
            Boolean(candidate.content.trim()) &&
            Buffer.byteLength(candidate.content, 'utf8') <= 100_000
            ? [{ id: candidate.id.trim(), content: candidate.content }]
            : [];
        })
      : undefined;
    const protectedStatements = protectedInput
      ? protectedInput.filter(
          (statement): statement is string =>
            typeof statement === 'string' && Boolean(statement.trim()),
        )
      : undefined;
    const claimTrace = claimTraceInput
      ? claimTraceInput.flatMap((trace): ClaimTraceEvidence[] => {
          if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return [];
          const candidate = trace as Record<string, unknown>;
          return typeof candidate.claim === 'string' &&
            typeof candidate.sourceId === 'string' &&
            typeof candidate.sourceExcerpt === 'string' &&
            Buffer.byteLength(candidate.claim, 'utf8') <= 10_000 &&
            Buffer.byteLength(candidate.sourceExcerpt, 'utf8') <= 20_000
            ? [
                {
                  claim: candidate.claim,
                  sourceId: candidate.sourceId,
                  sourceExcerpt: candidate.sourceExcerpt,
                },
              ]
            : [];
        })
      : undefined;
    if (
      !sources ||
      sources.length !== sourceInput?.length ||
      !claimTrace ||
      claimTrace.length !== claimTraceInput?.length ||
      !protectedStatements ||
      protectedStatements.length !== protectedInput?.length
    )
      return undefined;
    output.sourcePreservation = {
      draftSha256: item.draftSha256,
      sourcesSha256: item.sourcesSha256,
      sources,
      claimTrace,
      protectedStatements,
    };
  }
  return output;
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export const writingDraftDigest = digest;
export const writingSourcesDigest = (sources: readonly string[]): string =>
  digest(JSON.stringify([...sources]));

function gateDigest(gates: readonly WritingGateResult[]): string {
  return digest(JSON.stringify(gates.map(({ gate, state }) => [gate, state])));
}

/** Execute deterministic post-draft gates. Drafting and independent red-team work remain agent roles. */
export function inspectWritingDraft(input: {
  task: string;
  draft: string;
  sources?: readonly WritingSourceEvidence[];
  claimTrace?: readonly ClaimTraceEvidence[];
  protectedStatements?: readonly string[];
  detectorObservations?: readonly DetectorObservation[];
  evidence?: WritingGateEvidence;
  authority?: WritingRuntimeAuthority;
}): WritingRuntimeReport {
  const route = resolveWritingRoute(input.task);
  if (!route) throw new Error('task does not resolve to the canonical writing route');
  const boundSources = input.evidence?.sourcePreservation;
  const sources = boundSources?.sources ?? input.sources;
  const claimTrace = boundSources?.claimTrace ?? input.claimTrace;
  const protectedStatements = boundSources?.protectedStatements ?? input.protectedStatements;
  const diagnostics = diagnoseProse(input.draft, route.genre);
  const evaluation = evaluateWriting({
    draft: input.draft,
    brief: input.task,
    genre: route.genre,
    ...(sources ? { sources } : {}),
    ...(claimTrace ? { claimTrace } : {}),
    ...(protectedStatements ? { protectedStatements } : {}),
  });
  const vale = runLocalVale({
    text: input.draft,
    profile: route.lintProfile,
  });
  const detectorObservations = observeDetectors(input.detectorObservations ?? []);
  const draftSha256 = writingDraftDigest(input.draft);
  const gates: WritingGateResult[] = [];
  for (const gate of route.gates) {
    let result: WritingGateResult;
    if (gate === 'route')
      result = { gate, state: 'passed', detail: `resolved ${route.genre} route` };
    else if (gate === 'draft')
      result = {
        gate,
        state: input.draft.trim() ? 'passed' : 'failed',
        detail: input.draft.trim() ? 'draft supplied' : 'draft missing',
      };
    else if (gate === 'prose-lint')
      result =
        vale.state === 'available'
          ? {
              gate,
              state:
                vale.passed && !diagnostics.findings.some((f) => f.severity === 'error')
                  ? 'passed'
                  : 'failed',
              detail: `Vale ${vale.version}; ${vale.findings.length} parsed finding(s); Major contextual diagnostics complete`,
            }
          : {
              gate,
              state: 'degraded',
              detail: `${vale.state}: ${vale.detail} Major contextual diagnostics ran as fallback; this is not a full lint pass.`,
            };
    else if (gate === 'natural-writing-qa')
      result = {
        gate,
        state: diagnostics.findings.some((f) => f.severity === 'error') ? 'failed' : 'passed',
        detail: `${diagnostics.findings.length} contextual finding(s); confidence ${diagnostics.confidence}`,
      };
    else if (gate === 'substantive-evaluation')
      result = {
        gate,
        state: evaluation.pass ? 'passed' : 'failed',
        detail: 'critic-only multidimensional evaluation complete',
      };
    else if (gate === 'independent-red-team') {
      const evidence = input.authority?.redTeam;
      result =
        evidence && evidence.draftSha256 === draftSha256 && evidence.receiptId.trim()
          ? {
              gate,
              state: evidence.verdict === 'pass' ? 'passed' : 'failed',
              detail: `persisted independent-review receipt ${evidence.receiptId}`,
            }
          : {
              gate,
              state: 'pending',
              detail: 'Major persisted exact-draft independent-review receipt required',
            };
    } else if (gate === 'revision') {
      const evidence = input.evidence?.revision;
      const requiresRevision = diagnostics.findings.length > 0 || !evaluation.pass;
      result = !requiresRevision
        ? { gate, state: 'passed', detail: 'no revision-triggering findings remain' }
        : evidence &&
            evidence.afterDraftSha256 === draftSha256 &&
            evidence.beforeDraftSha256 !== evidence.afterDraftSha256 &&
            evidence.addressedFindingIds.length > 0
          ? { gate, state: 'passed', detail: 'exact before/after revision evidence recorded' }
          : {
              gate,
              state: 'pending',
              detail: 'bound revision delta required while findings remain',
            };
    } else if (gate === 'source-claim-check') {
      const sourceEvidence = input.evidence?.sourcePreservation;
      result =
        evaluation.claimTrace.state === 'supported' &&
        evaluation.factualPreservation.state === 'preserved' &&
        sourceEvidence?.draftSha256 === draftSha256 &&
        sourceEvidence.sourcesSha256 ===
          writingSourcesDigest(sourceEvidence.sources.map(({ id, content }) => `${id}\0${content}`))
          ? {
              gate,
              state: 'passed',
              detail: `${evaluation.claimTrace.evidence.length} bounded claim trace(s) matched supplied source content; supplied qualifications and procedures preserved`,
            }
          : {
              gate,
              state: 'failed',
              detail: `claim trace ${evaluation.claimTrace.state}; factual preservation ${evaluation.factualPreservation.state}`,
            };
    } else {
      const priorGatesSha256 = gateDigest(gates);
      result = gates.some(({ state }) => state !== 'passed')
        ? { gate, state: 'failed', detail: `prior gate failure; evidence ${priorGatesSha256}` }
        : {
            gate,
            state: 'passed',
            detail: `verified exact draft ${draftSha256} and prior gates ${priorGatesSha256}`,
          };
    }
    gates.push(result);
  }
  const revisionsTriggered = [
    ...new Set(
      [...diagnostics.findings, ...Object.values(evaluation.dimensions).flat()]
        .filter((f) => f.severity !== 'info')
        .map((f) => f.dimension),
    ),
  ];
  const finalState = gates.some((g) => g.state === 'failed' || g.state === 'pending')
    ? 'failed'
    : gates.some((g) => g.state === 'degraded')
      ? 'degraded'
      : 'passed';
  return {
    version: 1,
    route,
    selectedSkills: route.skills,
    selectionReasons: route.reasons,
    gates,
    pipeline: route.pipelineStages.map((stage) => ({
      stage,
      state:
        stage === 'brief' ||
        stage === 'deterministic-prose-lint' ||
        stage === 'natural-writing-qa' ||
        stage === 'substantive-writing-evaluator'
          ? 'ran'
          : stage === 'draft' && input.draft.trim()
            ? 'ran'
            : 'selected',
    })),
    diagnostics,
    vale,
    detectorObservations,
    evaluation,
    revisionsTriggered,
    finalState,
  };
}
