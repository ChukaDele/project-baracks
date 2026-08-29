import { existsSync } from 'node:fs';
import {
  bundledValeProfilePath,
  executeLocalDiagnostic,
  type LocalDiagnosticRequest,
  type LocalDiagnosticResult,
  type ValeProfile,
} from '../security/major-gateway.js';
import type { WritingFinding } from './types.js';

export interface ValeEvidence {
  engine: 'vale';
  state: 'available' | 'unavailable' | 'degraded';
  version?: string;
  configPath: string;
  findings: Array<WritingFinding & { line: number; span: [number, number] }>;
  passed: boolean;
  detail: string;
}

type ValeAlert = {
  Check?: string;
  Severity?: string;
  Message?: string;
  Match?: string;
  Line?: number;
  Span?: [number, number];
};

export type LocalDiagnosticExecutor = (input: LocalDiagnosticRequest) => LocalDiagnosticResult;

/** Run the fixed trusted Vale diagnostic through the gateway's argv-only seam. */
export function runLocalVale(
  input: {
    text: string;
    profile?: ValeProfile;
  },
  executor: LocalDiagnosticExecutor = executeLocalDiagnostic,
): ValeEvidence {
  const profile = input.profile ?? 'general';
  const configPath = bundledValeProfilePath(profile);
  if (!existsSync(configPath))
    return {
      engine: 'vale',
      state: 'degraded',
      configPath,
      findings: [],
      passed: false,
      detail: `Bundled Major Vale profile is unavailable: ${configPath}`,
    };
  const versionResult = executor({ operation: 'version' });
  if (versionResult.error || versionResult.status !== 0)
    return {
      engine: 'vale',
      state: 'unavailable',
      configPath,
      findings: [],
      passed: false,
      detail:
        versionResult.error?.message ?? 'Pinned Vale executable could not report its version.',
    };
  const version = versionResult.stdout.trim() || versionResult.stderr.trim();
  const result = executor({
    operation: 'lint',
    profile,
    stdin: input.text,
  });
  if (result.error || result.status !== 0)
    return {
      engine: 'vale',
      state: 'degraded',
      version,
      configPath,
      findings: [],
      passed: false,
      detail: (result.error?.message ?? result.stderr.trim()) || `Vale exited ${result.status}`,
    };
  try {
    const parsed = JSON.parse(result.stdout || '{}') as Record<string, ValeAlert[]>;
    const alerts = Object.values(parsed).flat();
    const findings = alerts.map((alert) => {
      const severity = normalizeSeverity(alert.Severity);
      const line = alert.Line ?? 1;
      const span = alert.Span ?? [1, 1];
      return {
        ruleId: alert.Check ?? 'vale.unknown',
        dimension: 'prose-lint',
        severity,
        message: alert.Message ?? 'Vale finding',
        evidence: alert.Match ?? extractEvidence(input.text, line, span),
        profile,
        suppression: {
          eligible: severity !== 'error',
          reason: 'Suppress only with documented source-faithful or profile-specific evidence.',
        },
        line,
        span,
      };
    });
    return {
      engine: 'vale',
      state: 'available',
      version,
      configPath,
      findings,
      passed: !findings.some((finding) => finding.severity === 'error'),
      detail: `${findings.length} parsed Vale finding(s).`,
    };
  } catch (error) {
    return {
      engine: 'vale',
      state: 'degraded',
      version,
      configPath,
      findings: [],
      passed: false,
      detail: `Vale returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function extractEvidence(text: string, line: number, span: [number, number]): string {
  const lineText = text.split(/\r?\n/u)[Math.max(0, line - 1)] ?? '';
  return lineText.slice(Math.max(0, span[0] - 1), Math.max(span[0], span[1]));
}

function normalizeSeverity(value?: string): WritingFinding['severity'] {
  const severity = value?.toLowerCase();
  return severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info';
}
