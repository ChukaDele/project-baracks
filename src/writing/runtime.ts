import { diagnoseProse, type ProseDiagnostics } from './diagnostics.js';
import { evaluateWriting, type ClaimTraceEvidence, type WritingEvaluation } from './evaluator.js';
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

/** Execute deterministic post-draft gates. Drafting and independent red-team work remain agent roles. */
export function inspectWritingDraft(input: {
  task: string;
  draft: string;
  sources?: readonly string[];
  claimTrace?: readonly ClaimTraceEvidence[];
  protectedStatements?: readonly string[];
  detectorObservations?: readonly DetectorObservation[];
  independentRedTeam?: {
    reviewerId: string;
    draftAuthorId: string;
    reviewRunId: string;
    passed: boolean;
    findings: string[];
  };
  revised?: boolean;
}): WritingRuntimeReport {
  const route = resolveWritingRoute(input.task);
  if (!route) throw new Error('task does not resolve to the canonical writing route');
  const diagnostics = diagnoseProse(input.draft, route.genre);
  const evaluation = evaluateWriting({
    draft: input.draft,
    brief: input.task,
    genre: route.genre,
    ...(input.sources ? { sources: input.sources } : {}),
    ...(input.claimTrace ? { claimTrace: input.claimTrace } : {}),
    ...(input.protectedStatements ? { protectedStatements: input.protectedStatements } : {}),
  });
  const vale = runLocalVale({
    text: input.draft,
    profile: route.lintProfile,
  });
  const detectorObservations = observeDetectors(input.detectorObservations ?? []);
  const gates: WritingGateResult[] = route.gates.map((gate) => {
    if (gate === 'route') return { gate, state: 'passed', detail: `resolved ${route.genre} route` };
    if (gate === 'draft')
      return {
        gate,
        state: input.draft.trim() ? 'passed' : 'failed',
        detail: input.draft.trim() ? 'draft supplied' : 'draft missing',
      };
    if (gate === 'prose-lint')
      return vale.state === 'available'
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
    if (gate === 'natural-writing-qa')
      return {
        gate,
        state: diagnostics.findings.some((f) => f.severity === 'error') ? 'failed' : 'passed',
        detail: `${diagnostics.findings.length} contextual finding(s); confidence ${diagnostics.confidence}`,
      };
    if (gate === 'substantive-evaluation')
      return {
        gate,
        state: evaluation.pass ? 'passed' : 'failed',
        detail: 'critic-only multidimensional evaluation complete',
      };
    if (gate === 'independent-red-team')
      return input.independentRedTeam &&
        input.independentRedTeam.reviewerId !== input.independentRedTeam.draftAuthorId &&
        input.independentRedTeam.reviewRunId.trim()
        ? {
            gate,
            state: input.independentRedTeam.passed ? 'passed' : 'failed',
            detail: `reviewed independently by ${input.independentRedTeam.reviewerId}; ${input.independentRedTeam.findings.length} finding(s)`,
          }
        : {
            gate,
            state: 'pending',
            detail: 'separate reviewer identity and review-run provenance required',
          };
    if (gate === 'revision')
      return {
        gate,
        state:
          input.revised || (diagnostics.findings.length === 0 && evaluation.pass)
            ? 'passed'
            : 'pending',
        detail: input.revised
          ? 'targeted revision recorded'
          : 'revision required when findings remain',
      };
    if (gate === 'source-claim-check')
      return evaluation.claimTrace.state === 'supported' &&
        evaluation.factualPreservation.state === 'preserved'
        ? {
            gate,
            state: 'passed',
            detail: `${evaluation.claimTrace.evidence.length} claim trace(s) supported; qualifications and procedures preserved`,
          }
        : {
            gate,
            state: 'failed',
            detail: `claim trace ${evaluation.claimTrace.state}; factual preservation ${evaluation.factualPreservation.state}`,
          };
    return { gate, state: 'passed', detail: 'all runnable required gates accounted for' };
  });
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
