import type { CapabilityRecord } from '../capabilities/registry.js';
import type { ProjectPolicy } from '../supervisor/policy.js';
import {
  DEFAULT_DECISION_CONFIDENCE,
  runDecision,
  type DecisionAdapter,
} from '../intelligence/decision-kernel.js';
import { redactText } from '../security/redact.js';
import { assertRemotePreviewUrl } from './remote-preview.js';

export type BrowserActionKind = 'inspect' | 'navigate' | 'click' | 'type' | 'verify' | 'stop';

export interface AllowedBrowserAction {
  id: string;
  kind: BrowserActionKind;
  description: string;
  target?: string | undefined;
  value?: string | undefined;
  externalWrite?: boolean | undefined;
  destructive?: boolean | undefined;
}

export interface BrowserActionSuggestion extends AllowedBrowserAction {
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

function browserCapabilityReady(capability: CapabilityRecord | undefined): boolean {
  return Boolean(
    capability &&
    capability.key === 'jev-browser-use' &&
    ['validated', 'preferred'].includes(capability.status) &&
    ['independently_validated', 'capability_verified'].includes(capability.validationState),
  );
}

export function browserWorkImplicated(task: string): boolean {
  return /\b(?:browser|web(?:site|app)?|frontend|page|preview|playwright|navigate|click|viewport|visual qa)\b/i.test(
    task,
  );
}

export async function suggestBrowserAction(
  input: {
    task: string;
    pageUrl: string;
    pageState: string;
    actions: readonly AllowedBrowserAction[];
    capability?: CapabilityRecord | undefined;
    policy: Pick<ProjectPolicy, 'allowExternalWrites'>;
  },
  options: { adapter?: DecisionAdapter; confidence?: number; telemetry?: boolean } = {},
): Promise<BrowserActionSuggestion | undefined> {
  if (!browserCapabilityReady(input.capability) || input.actions.length === 0) return undefined;
  assertRemotePreviewUrl(input.pageUrl);
  const actionCriteria: Record<string, string> = {
    none: 'Stop because no allowlisted action is appropriate.',
  };
  input.actions.forEach((action, index) => {
    actionCriteria[`action_${index}`] = `${action.kind}: ${action.description}`;
  });
  const result = await runDecision(
    {
      decision: 'browser-next-action',
      state: {
        task: redactText(input.task),
        page_url: input.pageUrl,
        page_state: redactText(input.pageState).slice(0, 12_000),
        allowlist: input.actions.map((action, index) => ({
          index,
          kind: action.kind,
          description: action.description,
          target: action.target ?? null,
        })),
      },
      questions: {
        action: {
          type: 'choice',
          instructions: 'Choose exactly one allowlisted next browser action, or stop.',
          criteria: actionCriteria,
        },
      },
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  if (!result.available) return undefined;
  const answer = result.answers.action;
  if (answer?.type !== 'choice' || answer.choice === 'none') return undefined;
  const match = /^action_(\d+)$/.exec(answer.choice);
  const index = match ? Number.parseInt(match[1]!, 10) : -1;
  const action = input.actions[index];
  if (!action) return undefined;
  if (action.kind === 'navigate' && action.target) assertRemotePreviewUrl(action.target);
  const threshold = options.confidence ?? DEFAULT_DECISION_CONFIDENCE;
  const destructive = action.destructive === true;
  const externalWrite =
    action.externalWrite === true ||
    action.kind === 'type' ||
    (action.kind === 'click' && action.externalWrite !== false);
  const allowed =
    answer.confidence >= threshold &&
    !destructive &&
    (!externalWrite || input.policy.allowExternalWrites);
  const risk = destructive ? 'high' : externalWrite || action.kind === 'click' ? 'medium' : 'low';
  return {
    ...action,
    confidence: answer.confidence,
    risk,
    allowed,
    requiresConfirmation: destructive || externalWrite || answer.confidence < threshold,
    reason: destructive
      ? 'destructive browser actions are refused'
      : externalWrite && !input.policy.allowExternalWrites
        ? 'project policy forbids external writes'
        : answer.confidence < threshold
          ? 'semantic confidence is below the automatic-action threshold'
          : externalWrite
            ? 'external-write action requires confirmation'
            : 'bounded read-only action is within policy',
  };
}
