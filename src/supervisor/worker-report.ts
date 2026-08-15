import { redactText } from '../security/redact.js';

const WORKER_REPORT_PREFIX = 'MAJOR_RESULT: ';
const FINAL_REPORT_TYPE = 'major.result.final';
const AMBIGUOUS_REPORT_TYPE = 'major.result.ambiguous';
export const AMBIGUOUS_WORKER_REPORT_ENVELOPE = JSON.stringify({
  type: AMBIGUOUS_REPORT_TYPE,
});

export interface WorkerReport {
  status: 'active' | 'blocked' | 'done';
  summary: string;
  ownerGate?: string;
  learning?: {
    source: 'user-correction' | 'recurring-failure' | 'successful-procedure' | 'manual';
    summary: string;
    key?: string;
    evidence?: string;
  };
  workflow?: {
    task: string;
    outcome: string;
    steps: string[];
    tools: string[];
    validations: string[];
    scope: 'project' | 'global';
  };
  capabilityUse?: { key: string; evidence: string }[];
}

export function completedWorkflow(
  report: WorkerReport | undefined,
): WorkerReport['workflow'] | undefined {
  return report?.status === 'done' ? report.workflow : undefined;
}

function reportLinesFromText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(WORKER_REPORT_PREFIX));
}

function reportLinesFromEnvelope(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const event = value as Record<string, unknown>;
  if (event.type === 'result') return reportLinesFromText(event.result);
  if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    return item.type === 'agent_message' ? reportLinesFromText(item.text) : [];
  }
  if (event.type !== 'assistant' || !event.message || typeof event.message !== 'object') {
    return [];
  }
  const content = (event.message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  const reports: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type !== undefined && candidate.type !== 'text') continue;
    reports.push(...reportLinesFromText(candidate.text));
  }
  return reports;
}

/** Preserve only the final provider-owned report from a complete event. This
 * keeps completion authority available even when the general output tail is
 * truncated, without retaining unbounded model output. */
export function preserveWorkerReportEnvelope(raw: string): string | undefined {
  try {
    const reports = reportLinesFromEnvelope(JSON.parse(raw));
    if (reports.length === 0) return undefined;
    if (reports.length !== 1) return AMBIGUOUS_WORKER_REPORT_ENVELOPE;
    return JSON.stringify({ type: FINAL_REPORT_TYPE, result: reports[0] });
  } catch {
    return undefined;
  }
}

/** Only known provider-owned assistant/result fields carry completion
 * authority. Bare stdout, tool output, and user-message payloads are ignored. */
export function parseWorkerReport(output: string): WorkerReport | undefined {
  const providerLines: string[] = [];
  const finalLines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const candidate = rawLine.trim();
    if (!candidate) continue;
    try {
      const event = JSON.parse(candidate) as Record<string, unknown>;
      if (event.type === AMBIGUOUS_REPORT_TYPE) return undefined;
      if (event.type === FINAL_REPORT_TYPE) {
        finalLines.push(...reportLinesFromText(event.result));
      } else {
        providerLines.push(...reportLinesFromEnvelope(event));
      }
    } catch {
      // Bare stdout is never completion authority.
    }
  }
  const eligible = finalLines.length > 0 ? finalLines : providerLines;
  if (eligible.length !== 1) return undefined;
  const line = eligible[0]!;
  try {
    const value = JSON.parse(line.slice(WORKER_REPORT_PREFIX.length)) as Record<string, unknown>;
    if (!['active', 'blocked', 'done'].includes(String(value.status))) return undefined;
    if (typeof value.summary !== 'string' || value.summary.trim().length === 0) return undefined;
    const summary = redactText(value.summary.trim()).slice(0, 12_000);
    const ownerGate =
      typeof value.ownerGate === 'string' ? redactText(value.ownerGate.trim()).slice(0, 4_000) : '';
    if (value.status === 'blocked' && !ownerGate) return undefined;
    let learning: WorkerReport['learning'];
    if (value.learning !== undefined) {
      if (!value.learning || typeof value.learning !== 'object' || Array.isArray(value.learning)) {
        return undefined;
      }
      const candidate = value.learning as Record<string, unknown>;
      const sources = [
        'user-correction',
        'recurring-failure',
        'successful-procedure',
        'manual',
      ] as const;
      if (!sources.includes(candidate.source as (typeof sources)[number])) return undefined;
      if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
        return undefined;
      }
      learning = {
        source: candidate.source as NonNullable<WorkerReport['learning']>['source'],
        summary: redactText(candidate.summary.trim()).slice(0, 4_000),
        ...(typeof candidate.key === 'string' && candidate.key.trim()
          ? { key: redactText(candidate.key.trim()).slice(0, 200) }
          : {}),
        ...(typeof candidate.evidence === 'string' && candidate.evidence.trim()
          ? { evidence: redactText(candidate.evidence.trim()).slice(0, 4_000) }
          : {}),
      };
    }
    let workflow: WorkerReport['workflow'];
    if (value.workflow !== undefined) {
      if (!value.workflow || typeof value.workflow !== 'object' || Array.isArray(value.workflow)) {
        return undefined;
      }
      const candidate = value.workflow as Record<string, unknown>;
      const strings = (name: string, required: boolean): string[] | undefined => {
        const list = candidate[name];
        if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
          return required ? undefined : [];
        }
        const sanitized = [
          ...new Set(
            list
              .filter((item): item is string => typeof item === 'string')
              .map((item) => redactText(item.trim()).slice(0, 1_000))
              .filter(Boolean),
          ),
        ];
        return required && sanitized.length === 0 ? undefined : sanitized.slice(0, 20);
      };
      const task =
        typeof candidate.task === 'string' ? redactText(candidate.task.trim()).slice(0, 2_000) : '';
      const outcome =
        typeof candidate.outcome === 'string'
          ? redactText(candidate.outcome.trim()).slice(0, 2_000)
          : '';
      const steps = strings('steps', true);
      const tools = strings('tools', false);
      const validations = strings('validations', true);
      const scope = candidate.scope === 'global' ? 'global' : 'project';
      if (!task || !outcome || !steps || !tools || !validations) return undefined;
      workflow = { task, outcome, steps, tools, validations, scope };
    }
    let capabilityUse: WorkerReport['capabilityUse'];
    if (value.capabilityUse !== undefined) {
      if (!Array.isArray(value.capabilityUse) || value.capabilityUse.length > 24) return undefined;
      const seen = new Set<string>();
      capabilityUse = [];
      for (const item of value.capabilityUse) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const candidate = item as Record<string, unknown>;
        const key = typeof candidate.key === 'string' ? candidate.key.trim() : '';
        const evidence = typeof candidate.evidence === 'string' ? candidate.evidence.trim() : '';
        if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(key) || !evidence || seen.has(key)) return undefined;
        seen.add(key);
        capabilityUse.push({ key, evidence: redactText(evidence).slice(0, 2_000) });
      }
    }
    return {
      status: value.status as WorkerReport['status'],
      summary,
      ...(ownerGate ? { ownerGate } : {}),
      ...(learning ? { learning } : {}),
      ...(workflow ? { workflow } : {}),
      ...(capabilityUse ? { capabilityUse } : {}),
    };
  } catch {
    return undefined;
  }
}
