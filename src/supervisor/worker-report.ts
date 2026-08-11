import { redactText } from '../security/redact.js';

const WORKER_REPORT_PREFIX = 'MAJOR_RESULT: ';

export interface WorkerReport {
  status: 'active' | 'blocked' | 'done';
  summary: string;
  ownerGate?: string;
}

function reportLineFromText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let report: string | undefined;
  for (const line of value.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate.startsWith(WORKER_REPORT_PREFIX)) report = candidate;
  }
  return report;
}

function reportLineFromEnvelope(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (event.type === 'result') return reportLineFromText(event.result);
  if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    return item.type === 'agent_message' ? reportLineFromText(item.text) : undefined;
  }
  if (event.type !== 'assistant' || !event.message || typeof event.message !== 'object') {
    return undefined;
  }
  const content = (event.message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return undefined;
  let report: string | undefined;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type !== undefined && candidate.type !== 'text') continue;
    report = reportLineFromText(candidate.text) ?? report;
  }
  return report;
}

/** Preserve only the final provider-owned report from a complete event. This
 * keeps completion authority available even when the general output tail is
 * truncated, without retaining unbounded model output. */
export function preserveWorkerReportEnvelope(raw: string): string | undefined {
  try {
    const report = reportLineFromEnvelope(JSON.parse(raw));
    return report ? JSON.stringify({ type: 'result', result: report }) : undefined;
  } catch {
    return undefined;
  }
}

/** Only known provider-owned assistant/result fields carry completion
 * authority. Bare stdout, tool output, and user-message payloads are ignored. */
export function parseWorkerReport(output: string): WorkerReport | undefined {
  let line: string | undefined;
  for (const rawLine of output.split(/\r?\n/)) {
    const candidate = rawLine.trim();
    if (!candidate) continue;
    try {
      line = reportLineFromEnvelope(JSON.parse(candidate)) ?? line;
    } catch {
      // Bare stdout is never completion authority.
    }
  }
  if (!line) return undefined;
  try {
    const value = JSON.parse(line.slice(WORKER_REPORT_PREFIX.length)) as Record<string, unknown>;
    if (!['active', 'blocked', 'done'].includes(String(value.status))) return undefined;
    if (typeof value.summary !== 'string' || value.summary.trim().length === 0) return undefined;
    const summary = redactText(value.summary.trim()).slice(0, 12_000);
    const ownerGate =
      typeof value.ownerGate === 'string' ? redactText(value.ownerGate.trim()).slice(0, 4_000) : '';
    if (value.status === 'blocked' && !ownerGate) return undefined;
    return {
      status: value.status as WorkerReport['status'],
      summary,
      ...(ownerGate ? { ownerGate } : {}),
    };
  } catch {
    return undefined;
  }
}
