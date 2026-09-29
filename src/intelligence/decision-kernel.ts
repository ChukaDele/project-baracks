import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  choice,
  noul,
  score,
  TypeSafeClient,
  type EntryType,
  type Question,
  type Questions,
  type ResultFor,
  type SystemOneResult,
} from '@typesafe-ai/sdk';
import { redactValue } from '../security/redact.js';
import type { ProjectPolicy } from '../supervisor/policy.js';
import { majorHome } from '../supervisor/state.js';

export const DEFAULT_DECISION_CONFIDENCE = 0.72;
export const DEFAULT_DECISION_TIMEOUT_MS = 2_500;

export type DecisionQuestion =
  | {
      type: 'choice';
      instructions: EntryType;
      criteria: Record<string, EntryType>;
    }
  | {
      type: 'noul';
      instructions: EntryType;
      criteria?: { true?: EntryType; false?: EntryType } | null;
    }
  | {
      type: 'score';
      instructions: EntryType;
      criteria: readonly [EntryType, EntryType, ...EntryType[]];
    };

export type DecisionAnswer =
  | {
      type: 'choice';
      choice: string;
      confidence: number;
      probabilities: Readonly<Record<string, number>>;
    }
  | { type: 'noul'; noul: number }
  | {
      type: 'score';
      score: number;
      confidence: number;
      probabilities: Readonly<Record<string, number>>;
    };

export interface DecisionRequest {
  decision: string;
  state: EntryType;
  questions: Readonly<Record<string, DecisionQuestion>>;
}

export interface DecisionAdapterResult {
  answers: Readonly<Record<string, unknown>>;
  model?: string | undefined;
}

export interface DecisionAdapter {
  evaluate(
    request: DecisionRequest,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<DecisionAdapterResult>;
}

export type DecisionResult =
  | {
      available: true;
      answers: Readonly<Record<string, DecisionAnswer>>;
      durationMs: number;
      model?: string | undefined;
    }
  | {
      available: false;
      reason: 'disabled' | 'timeout' | 'error' | 'malformed';
      durationMs: number;
    };

export interface DecisionOptions {
  adapter?: DecisionAdapter | undefined;
  timeoutMs?: number | undefined;
  telemetry?: boolean | undefined;
}

export type SemanticRisk = 'normal' | 'high' | 'security_sensitive';

export function answerConfidence(answer: ResultFor<Question>): number {
  return answer.type === 'noul' ? Math.abs(answer.noul - 0.5) * 2 : answer.confidence;
}

export function meetsThreshold(confidence: number, risk: SemanticRisk): boolean {
  const threshold =
    risk === 'security_sensitive' ? 0.9 : risk === 'high' ? 0.82 : DEFAULT_DECISION_CONFIDENCE;
  return Number.isFinite(confidence) && confidence >= threshold;
}

let client: TypeSafeClient | undefined;
let clientConfiguration: string | undefined;

export function semanticEgressEnabled(): boolean {
  return process.env.MAJOR_SEMANTIC_EGRESS?.trim().toLowerCase() === 'allow';
}

/** Runtime project boundary for semantic state. Injected adapters remain
 * useful for tests, but they do not relax the client/unknown data boundary. */
export function semanticEgressAllowed(policy: Pick<ProjectPolicy, 'projectClass'>): boolean {
  return policy.projectClass === 'workshop' || policy.projectClass === 'knowledge';
}

export function decisionKernelEnabled(adapter?: DecisionAdapter): boolean {
  return Boolean(adapter || (process.env.TYPESAFE_API_KEY?.trim() && semanticEgressEnabled()));
}

function typeSafeClient(): TypeSafeClient {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is unavailable');
  if (!semanticEgressEnabled()) {
    throw new Error('MAJOR_SEMANTIC_EGRESS=allow is required before sending semantic state');
  }
  const endpoint = process.env.TYPESAFE_ENDPOINT?.trim() || process.env.TYPESAFE_BASE_URL?.trim();
  const configuration = `${apiKey}\0${endpoint ?? ''}`;
  if (!client || clientConfiguration !== configuration) {
    client = new TypeSafeClient({
      apiKey,
      ...(endpoint ? { baseURL: endpoint } : {}),
      logLevel: 'off',
      retry: { maxRetries: 0 },
      timeout: DEFAULT_DECISION_TIMEOUT_MS,
    });
    clientConfiguration = configuration;
  }
  return client;
}

export function redactSemanticEntry(value: EntryType): EntryType {
  return redactValue(value);
}

function sdkQuestion(question: DecisionQuestion): Question {
  switch (question.type) {
    case 'choice':
      return choice(
        redactSemanticEntry(question.instructions),
        Object.fromEntries(
          Object.entries(question.criteria).map(([key, value]) => [
            key,
            redactSemanticEntry(value),
          ]),
        ),
      );
    case 'noul':
      return noul(
        redactSemanticEntry(question.instructions),
        question.criteria
          ? {
              ...(question.criteria.true === undefined
                ? {}
                : { true: redactSemanticEntry(question.criteria.true) }),
              ...(question.criteria.false === undefined
                ? {}
                : { false: redactSemanticEntry(question.criteria.false) }),
            }
          : question.criteria,
      );
    case 'score':
      return score(
        redactSemanticEntry(question.instructions),
        question.criteria.map((item) => redactSemanticEntry(item)) as [
          EntryType,
          EntryType,
          ...EntryType[],
        ],
      );
  }
}

const typeSafeAdapter: DecisionAdapter = {
  async evaluate(request, options) {
    const questions: Questions = Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => [key, sdkQuestion(question)]),
    );
    const result = await typeSafeClient().systemOne(
      { state: redactSemanticEntry(request.state), questions },
      {
        signal: options.signal,
        timeout: options.timeoutMs,
        retry: { maxRetries: 0 },
      },
    );
    return { answers: result.answers, model: result.model };
  },
};

function finiteProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilities(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, probability] of Object.entries(value)) {
    if (!finiteProbability(probability)) return undefined;
    result[key] = probability;
  }
  return result;
}

function validateAnswer(question: DecisionQuestion, value: unknown): DecisionAnswer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const answer = value as Record<string, unknown>;
  if (answer.type !== question.type) return undefined;
  if (question.type === 'choice') {
    const distribution = probabilities(answer.probabilities);
    if (
      typeof answer.choice !== 'string' ||
      !(answer.choice in question.criteria) ||
      !finiteProbability(answer.confidence) ||
      !distribution ||
      Object.keys(question.criteria).some((key) => distribution[key] === undefined)
    ) {
      return undefined;
    }
    return {
      type: 'choice',
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: distribution,
    };
  }
  if (question.type === 'noul') {
    return finiteProbability(answer.noul) ? { type: 'noul', noul: answer.noul } : undefined;
  }
  const distribution = probabilities(answer.probabilities);
  if (
    typeof answer.score !== 'number' ||
    !Number.isFinite(answer.score) ||
    !finiteProbability(answer.confidence) ||
    !distribution
  ) {
    return undefined;
  }
  return {
    type: 'score',
    score: answer.score,
    confidence: answer.confidence,
    probabilities: distribution,
  };
}

function telemetryPath(): string {
  return join(majorHome(), 'decision-kernel', 'events.jsonl');
}

function recordTelemetry(event: Record<string, unknown>): void {
  try {
    const path = telemetryPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Decision telemetry is audit evidence, never execution authority.
  }
}

export async function runDecision(
  request: DecisionRequest,
  options: DecisionOptions = {},
): Promise<DecisionResult> {
  const startedAt = Date.now();
  const emit = (result: DecisionResult, confidence?: number) => {
    if (options.telemetry === false) return result;
    recordTelemetry({
      at: new Date().toISOString(),
      decision: request.decision,
      status: result.available ? 'decided' : result.reason,
      durationMs: result.durationMs,
      questionCount: Object.keys(request.questions).length,
      ...(result.available && result.model ? { model: result.model } : {}),
      ...(confidence === undefined ? {} : { confidence }),
    });
    return result;
  };
  if (!decisionKernelEnabled(options.adapter)) {
    return { available: false, reason: 'disabled', durationMs: 0 };
  }
  const timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;
  let rejectTimeout: ((reason: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new Error('decision timed out'));
  }, timeoutMs);
  try {
    const safeRequest: DecisionRequest = {
      ...request,
      state: redactSemanticEntry(request.state),
    };
    const raw = await Promise.race([
      (options.adapter ?? typeSafeAdapter).evaluate(safeRequest, {
        signal: controller.signal,
        timeoutMs,
      }),
      timeoutPromise,
    ]);
    const answers: Record<string, DecisionAnswer> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      const answer = validateAnswer(question, raw.answers[key]);
      if (!answer) {
        return emit({
          available: false,
          reason: 'malformed',
          durationMs: Date.now() - startedAt,
        });
      }
      answers[key] = answer;
    }
    const confidences = Object.values(answers).flatMap((answer) =>
      answer.type === 'noul' ? [] : [answer.confidence],
    );
    return emit(
      {
        available: true,
        answers,
        durationMs: Date.now() - startedAt,
        ...(raw.model ? { model: raw.model } : {}),
      },
      confidences.length === 0
        ? undefined
        : Math.min(...confidences.map((value) => Math.round(value * 1_000) / 1_000)),
    );
  } catch {
    return emit({
      available: false,
      reason: timedOut ? 'timeout' : 'error',
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decisionQuestion(question: Question): DecisionQuestion {
  switch (question.type) {
    case 'choice':
      return {
        type: 'choice',
        instructions: question.instructions ?? null,
        criteria: question.criteria,
      };
    case 'noul':
      return {
        type: 'noul',
        instructions: question.instructions ?? null,
        ...(question.criteria === undefined ? {} : { criteria: question.criteria }),
      };
    case 'score':
      return {
        type: 'score',
        instructions: question.instructions ?? null,
        criteria: question.criteria,
      };
  }
}

/** Compatibility wrapper for consumers that construct questions with the
 * SDK helpers. It retains their inferred answer types while using the same
 * timeout, malformed-response validation, fallback, and telemetry path. */
export async function runSemanticDecision<const Q extends Questions>(input: {
  kind: string;
  state: EntryType;
  questions: Q;
  adapter?: DecisionAdapter | undefined;
  timeoutMs?: number | undefined;
}): Promise<
  | { kind: 'decision'; result: SystemOneResult<Q>; durationMs: number }
  | { kind: 'fallback'; reason: 'disabled' | 'timeout' | 'error' | 'malformed' }
> {
  const result = await runDecision(
    {
      decision: input.kind,
      state: input.state,
      questions: Object.fromEntries(
        Object.entries(input.questions).map(([key, question]) => [key, decisionQuestion(question)]),
      ),
    },
    { adapter: input.adapter, timeoutMs: input.timeoutMs },
  );
  if (!result.available) return { kind: 'fallback', reason: result.reason };
  return {
    kind: 'decision',
    result: {
      model: result.model ?? 'injected-adapter',
      answers: result.answers as SystemOneResult<Q>['answers'],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    durationMs: result.durationMs,
  };
}
