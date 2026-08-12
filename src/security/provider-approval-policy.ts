import type { ProviderCommandHost } from '../providers/commands.js';

/** Major-owned action classes. Provider labels are evidence, never authority. */
export type ProviderActionKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'dependency_install'
  | 'external_integration'
  | 'push'
  | 'deploy'
  | 'destructive'
  | 'unknown';

export type ApprovalCategory =
  'command_execution' | 'dependency_install' | 'external_integration' | 'push' | 'deploy';

export interface ProviderAction {
  kind: ProviderActionKind;
  /** Provider-supplied context used only to tighten the decision. */
  name?: string;
  title?: string;
  rawInput?: unknown;
}

export interface ProviderApprovalAuthority {
  /** Categories already authorised by a verified Major DecisionRequest. */
  approvedCategories: readonly ApprovalCategory[];
  /** Explicit evidence that the provider tried to evade the approval protocol. */
  bypassAttempted?: boolean;
}

export type ProviderApprovalDecision =
  | { outcome: 'automatic'; reason: string }
  | { outcome: 'approval_required'; category: ApprovalCategory; reason: string }
  | { outcome: 'forbidden'; reason: string }
  | { outcome: 'unsupported'; reason: string };

const INTERACTIVE_APPROVAL_HOSTS = new Set<ProviderCommandHost>(['cursor']);
const AUTOMATIC = new Set<ProviderActionKind>(['read', 'edit', 'move', 'search', 'think']);

const APPROVAL_REQUIRED = new Map<ProviderActionKind, ApprovalCategory>([
  ['execute', 'command_execution'],
  ['dependency_install', 'dependency_install'],
  ['external_integration', 'external_integration'],
  ['push', 'push'],
  ['deploy', 'deploy'],
  ['fetch', 'external_integration'],
]);

const DESTRUCTIVE_COMMAND =
  /\b(?:rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)|git\s+(?:reset\s+--hard|clean\s+-[^\s]*f)|mkfs(?:\.|\s)|shutdown(?:\s|$)|reboot(?:\s|$))/i;
const PUSH_COMMAND = /\b(?:git\s+push|gh\s+pr\s+merge)\b/i;
const DEPLOY_COMMAND =
  /\b(?:wrangler\s+deploy|vercel\s+(?:deploy|--prod)|netlify\s+deploy|npm\s+publish)\b/i;
const INSTALL_COMMAND = /\b(?:npm|pnpm|yarn|bun|pip|pip3|apt|apt-get|brew)\s+(?:add|install|i)\b/i;

function commandText(action: ProviderAction): string {
  const raw =
    typeof action.rawInput === 'string'
      ? action.rawInput
      : action.rawInput && typeof action.rawInput === 'object'
        ? JSON.stringify(action.rawInput)
        : '';
  return [action.name, action.title, raw].filter(Boolean).join(' ');
}

/** Tighten a provider's coarse tool kind using the command it disclosed. */
export function classifyProviderAction(action: ProviderAction): ProviderActionKind {
  const text = commandText(action);
  if (DESTRUCTIVE_COMMAND.test(text)) return 'destructive';
  if (PUSH_COMMAND.test(text)) return 'push';
  if (DEPLOY_COMMAND.test(text)) return 'deploy';
  if (INSTALL_COMMAND.test(text)) return 'dependency_install';
  return action.kind;
}

/**
 * The one authoritative provider-action policy path.
 *
 * Cursor can present each typed action to Major. Batch CLI providers cannot,
 * so they may perform only automatic work in the disposable guest workspace.
 * They are never reported as supporting per-tool approval.
 */
export function decideProviderAction(input: {
  host: ProviderCommandHost;
  action: ProviderAction;
  authority: ProviderApprovalAuthority;
}): ProviderApprovalDecision {
  if (input.authority.bypassAttempted) {
    return { outcome: 'forbidden', reason: 'provider attempted to bypass Major approval policy' };
  }

  const kind = classifyProviderAction(input.action);
  if (kind === 'delete' || kind === 'destructive' || kind === 'unknown') {
    return { outcome: 'forbidden', reason: `Major forbids provider action '${kind}'` };
  }

  const category = APPROVAL_REQUIRED.get(kind);
  if (category) {
    if (!INTERACTIVE_APPROVAL_HOSTS.has(input.host)) {
      return {
        outcome: 'unsupported',
        reason: `${input.host} does not expose per-tool approval semantics; '${category}' cannot be routed to it`,
      };
    }
    if (!input.authority.approvedCategories.includes(category)) {
      return {
        outcome: 'approval_required',
        category,
        reason: `Major DecisionRequest approval is required for '${category}'`,
      };
    }
    return { outcome: 'automatic', reason: `Major approved '${category}' for this run` };
  }

  if (AUTOMATIC.has(kind)) {
    return { outcome: 'automatic', reason: `Major classifies '${kind}' as automatic` };
  }
  return { outcome: 'forbidden', reason: `Major has no policy for provider action '${kind}'` };
}

export function providerSupportsInteractiveApproval(host: ProviderCommandHost): boolean {
  return INTERACTIVE_APPROVAL_HOSTS.has(host);
}

/** Reject an execution envelope that claims authority the provider cannot honour. */
export function validateProviderApprovalAuthority(
  host: ProviderCommandHost,
  authority: ProviderApprovalAuthority,
): void {
  if (authority.bypassAttempted) {
    throw new Error('provider attempted to bypass Major approval policy');
  }
  if (authority.approvedCategories.length > 0 && !providerSupportsInteractiveApproval(host)) {
    throw new Error(
      `${host} does not expose per-tool approval semantics; approval-required work cannot be routed to it`,
    );
  }
}
