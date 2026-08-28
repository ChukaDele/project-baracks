import type { MajorDashboard } from '../ui/dashboard.js';

export const CONTEXT_PACK_SECTIONS = [
  'overview',
  'execution',
  'skills',
  'memory',
  'history',
  'resources',
] as const;

export type ContextPackSection = (typeof CONTEXT_PACK_SECTIONS)[number];
export type ContextPackDetail = 'summary' | 'standard' | 'full';

export interface ContextPackOptions {
  detail?: ContextPackDetail;
  sections?: readonly ContextPackSection[];
  maxBytes?: number;
}

interface ContextEvidence {
  source: string;
  qualification: 'direct' | 'derived' | 'reported';
  observedAt: string;
}

const DEFAULT_MAX_BYTES = 16_000;
const MIN_MAX_BYTES = 2_000;
const MAX_MAX_BYTES = 64_000;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function limitFor(detail: ContextPackDetail): number {
  return detail === 'summary' ? 3 : detail === 'standard' ? 8 : 20;
}

function limited<T>(values: readonly T[], limit: number): T[] {
  return values.slice(0, limit);
}

function clip(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function evidence(
  source: string,
  qualification: ContextEvidence['qualification'],
  observedAt: string,
) {
  return { source, qualification, observedAt } satisfies ContextEvidence;
}

/**
 * Convert the existing dashboard into a deterministic, progressive context
 * pack. GBrain and run history remain the sources of truth; this is only a
 * bounded projection for clients and provider prompts.
 */
export function buildContextPack(dashboard: MajorDashboard, options: ContextPackOptions = {}) {
  const detail = options.detail ?? 'standard';
  const requested = options.sections ?? CONTEXT_PACK_SECTIONS;
  const sections = CONTEXT_PACK_SECTIONS.filter((section) => requested.includes(section));
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    Math.min(MAX_MAX_BYTES, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES)),
  );
  const itemLimit = limitFor(detail);
  const textLimit = detail === 'summary' ? 240 : detail === 'standard' ? 600 : 1_200;
  const data: Record<string, unknown> = {};
  const evidenceIndex: Record<string, ContextEvidence[]> = {};

  if (sections.includes('overview')) {
    data.overview = {
      project: dashboard.project
        ? {
            identity: clip(dashboard.project.identity, textLimit),
            repoPath: clip(dashboard.project.repoPath, textLimit),
          }
        : null,
      objective: dashboard.objective
        ? {
            ...dashboard.objective,
            goal: clip(dashboard.objective.goal, textLimit),
            lastSummary: clip(dashboard.objective.lastSummary, textLimit),
            ownerGate: clip(dashboard.objective.ownerGate, textLimit),
          }
        : null,
      policy: dashboard.policy,
      gbrain: {
        ...dashboard.gbrain,
        sources: limited(dashboard.gbrain.sources, itemLimit).map((source) =>
          clip(source, textLimit)!,
        ),
      },
    };
    evidenceIndex.overview = [
      evidence('Major supervisor and project policy stores', 'direct', dashboard.generatedAt),
    ];
  }
  if (sections.includes('execution')) {
    data.execution = {
      execution: dashboard.execution,
      workers: limited(dashboard.workers, itemLimit),
    };
    evidenceIndex.execution = [
      evidence('Major gateway inspection and supervisor state', 'direct', dashboard.generatedAt),
    ];
  }
  if (sections.includes('skills')) {
    data.skills = {
      ...dashboard.skills,
      selected: limited(dashboard.skills.selected, itemLimit),
    };
    evidenceIndex.skills = [
      evidence(
        'Deterministic skill registry resolver and reachability audit',
        'derived',
        dashboard.generatedAt,
      ),
    ];
  }
  if (sections.includes('memory')) {
    data.memory = {
      context: {
        memories: limited(dashboard.context.memories, itemLimit),
        decisions: limited(dashboard.context.decisions, itemLimit),
        unresolvedQuestions: limited(dashboard.context.unresolvedQuestions, itemLimit),
      },
      learning: limited(dashboard.learning, itemLimit).map((item) => ({
        ...item,
        evidence: limited(item.evidence, detail === 'full' ? 3 : 1),
      })),
    };
    evidenceIndex.memory = [
      evidence(
        'Project-local GBrain context and sanitized learning store',
        'reported',
        dashboard.generatedAt,
      ),
    ];
  }
  if (sections.includes('history')) {
    data.history = {
      aggregate: dashboard.history,
      recentRuns: limited(dashboard.recentRuns, itemLimit),
    };
    evidenceIndex.history = [
      evidence('Persisted evidence-qualified run observations', 'derived', dashboard.generatedAt),
    ];
  }
  if (sections.includes('resources')) {
    data.resources = {
      telemetry: dashboard.resources,
      providers: limited(dashboard.providers, itemLimit),
      hosts: limited(dashboard.hosts, itemLimit),
    };
    evidenceIndex.resources = [
      evidence('Read-only resource, provider, and host snapshots', 'direct', dashboard.generatedAt),
    ];
  }

  const omittedSections = CONTEXT_PACK_SECTIONS.filter((section) => !sections.includes(section));
  const pack = {
    schemaVersion: 2,
    kind: 'major.context-pack.v2',
    disclosure: {
      detail,
      maxBytes,
      includedSections: [...sections],
      omittedSections,
      truncated: false,
    },
    evidence: evidenceIndex,
    data,
  };

  if (
    dashboard.objective?.goal.length !==
      ((data.overview as { objective?: { goal?: string } } | undefined)?.objective?.goal?.length ??
        dashboard.objective?.goal.length) ||
    dashboard.gbrain.sources.length > itemLimit
  ) {
    pack.disclosure.truncated = true;
  }

  // Remove lowest-priority requested sections until the serialized pack fits.
  // Overview is retained when possible; an adversarially large overview is
  // omitted rather than violating the caller's hard ceiling.
  for (const section of [...sections].reverse()) {
    if (jsonBytes(pack) <= maxBytes) break;
    if (section === 'overview' && sections.includes('overview')) continue;
    delete data[section];
    delete evidenceIndex[section];
    pack.disclosure.includedSections = pack.disclosure.includedSections.filter(
      (candidate) => candidate !== section,
    );
    if (!pack.disclosure.omittedSections.includes(section))
      pack.disclosure.omittedSections.push(section);
    pack.disclosure.truncated = true;
  }
  if (jsonBytes(pack) > maxBytes && data.overview) {
    delete data.overview;
    delete evidenceIndex.overview;
    pack.disclosure.includedSections = pack.disclosure.includedSections.filter(
      (candidate) => candidate !== 'overview',
    );
    if (!pack.disclosure.omittedSections.includes('overview'))
      pack.disclosure.omittedSections.push('overview');
    pack.disclosure.truncated = true;
  }
  return pack;
}
