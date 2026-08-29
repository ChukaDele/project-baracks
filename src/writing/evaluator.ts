import { diagnoseProse } from './diagnostics.js';
import type { WritingFinding, WritingGenre } from './types.js';

export interface WritingEvaluation {
  version: 1;
  evaluatorRole: 'critic-only';
  aggregation: 'none';
  dimensions: Record<string, WritingFinding[]>;
  dimensionPass: Record<string, boolean>;
  pass: boolean;
  claimTrace: {
    required: boolean;
    state: 'not-applicable' | 'missing' | 'unsupported' | 'supported';
    evidence: ClaimTraceEvidence[];
  };
  factualPreservation: {
    required: boolean;
    state: 'not-applicable' | 'missing' | 'changed' | 'preserved';
    evidence: Array<{ text: string; preserved: boolean }>;
  };
}

export interface ClaimTraceEvidence {
  claim: string;
  sourceId?: string;
  sourceExcerpt?: string;
  supported: boolean;
}

export function evaluateWriting(input: {
  draft: string;
  brief: string;
  genre: WritingGenre;
  sources?: readonly string[];
  claimTrace?: readonly ClaimTraceEvidence[];
  protectedStatements?: readonly string[];
}): WritingEvaluation {
  const d = diagnoseProse(input.draft, input.genre);
  const dimensions: Record<string, WritingFinding[]> = Object.fromEntries(
    [
      'thesis',
      'specificity',
      'evidence',
      'claim-strength',
      'reasoning',
      'redundancy',
      'abstraction',
      'reader-value',
      'genre-fit',
      'voice-fidelity',
      'naturalness',
      'instruction-adherence',
      'source-fidelity',
      'factual-preservation',
    ].map((key) => [key, []]),
  );
  const add = (dimension: string, finding: WritingFinding): void => {
    (dimensions[dimension] ??= []).push(finding);
  };
  for (const finding of d.findings) add('naturalness', finding);
  if (d.words > 180 && !/[.!?]\s/.test(input.draft.slice(0, 240)))
    add('thesis', {
      dimension: 'thesis',
      severity: 'warning',
      message: 'The opening does not establish a clear substantive point.',
    });
  if (
    d.words > 120 &&
    !/\b(?:\d+(?:\.\d+)?%?|for example|for instance|according to|such as)\b/i.test(input.draft)
  )
    add('specificity', {
      dimension: 'specificity',
      severity: 'warning',
      message: 'Long draft lacks concrete examples, names, or numbers.',
    });
  if (
    /\b(?:always|never|proves?|guarantees?|all|none)\b/i.test(input.draft) &&
    !input.sources?.length
  )
    add('claim-strength', {
      dimension: 'claim-strength',
      severity: 'error',
      message: 'Strong universal claim has no supplied source.',
    });
  const sourceDependent = input.genre === 'academic' || input.genre === 'technical';
  const suppliedSources = new Set(input.sources ?? []);
  const claimTraceState = !sourceDependent
    ? 'not-applicable'
    : !input.claimTrace?.length
      ? 'missing'
      : input.claimTrace.every(
            (trace) =>
              trace.supported &&
              trace.sourceId?.trim() &&
              suppliedSources.has(trace.sourceId) &&
              trace.sourceExcerpt?.trim(),
          )
        ? 'supported'
        : 'unsupported';
  if (sourceDependent && claimTraceState !== 'supported')
    add('source-fidelity', {
      dimension: 'source-fidelity',
      severity: 'error',
      message:
        claimTraceState === 'missing'
          ? 'Source-dependent genre has no claim trace.'
          : 'One or more material claims lack traceable source support.',
    });
  const preservationEvidence = (input.protectedStatements ?? []).map((text) => ({
    text,
    preserved: input.draft.includes(text),
  }));
  const preservationState = !sourceDependent
    ? 'not-applicable'
    : preservationEvidence.length === 0
      ? 'missing'
      : preservationEvidence.every((item) => item.preserved)
        ? 'preserved'
        : 'changed';
  if (sourceDependent && preservationState !== 'preserved')
    add('factual-preservation', {
      dimension: 'factual-preservation',
      severity: 'error',
      message:
        preservationState === 'missing'
          ? 'No protected qualifications or procedural statements were supplied for preservation checks.'
          : 'A protected qualification or procedural statement changed or disappeared.',
    });
  if (input.brief.trim().length < 8)
    add('instruction-adherence', {
      dimension: 'instruction-adherence',
      severity: 'warning',
      message: 'Brief is too thin to verify adherence.',
    });
  const findings = Object.values(dimensions).flat();
  return {
    version: 1,
    evaluatorRole: 'critic-only',
    aggregation: 'none',
    dimensions,
    dimensionPass: Object.fromEntries(
      Object.entries(dimensions).map(([key, value]) => [
        key,
        value.every((finding) => finding.severity !== 'error'),
      ]),
    ),
    pass: findings.every((f) => f.severity !== 'error'),
    claimTrace: {
      required: sourceDependent,
      state: claimTraceState,
      evidence: [...(input.claimTrace ?? [])],
    },
    factualPreservation: {
      required: sourceDependent,
      state: preservationState,
      evidence: preservationEvidence,
    },
  };
}
