import type { ProviderCommandHost } from '../providers/commands.js';
import type { BackendExecutionAuthority } from './staged-validation.js';

const WORKSPACE_HASH = /^[0-9a-f]{64}$/;

export interface GuestMutationPolicyInput {
  host: ProviderCommandHost;
  allowGuestMutation: boolean;
  workspaceHash?: string;
  executionAuthorityKind: BackendExecutionAuthority['kind'];
  isolatedBackend: boolean;
}

/**
 * Codex may mutate the quarantined guest copy and copy a validated delta
 * back only inside Lima plus an active Supervised Workshop session.
 * Claude/Cursor keep their existing mutation contracts. Antigravity stays
 * read-only. Callers cannot self-authorise by setting the flag.
 */
export function assertGuestMutationPolicy(input: GuestMutationPolicyInput): void {
  if (input.host === 'antigravity' && input.allowGuestMutation) {
    throw new Error('antigravity cannot mutate the quarantined guest workspace');
  }
  if (!input.allowGuestMutation) return;
  if (!input.workspaceHash || !WORKSPACE_HASH.test(input.workspaceHash)) {
    throw new Error('mutable provider execution requires a source workspace digest');
  }
  if (input.host !== 'codex') return;
  if (!input.isolatedBackend) {
    throw new Error('Codex guest mutation requires the Lima execution backend');
  }
  if (input.executionAuthorityKind !== 'supervised_workshop') {
    throw new Error('Codex guest mutation requires active supervised Workshop authority');
  }
}
