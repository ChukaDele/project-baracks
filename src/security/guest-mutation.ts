import type { ProviderCommandHost } from '../providers/commands.js';
import type { BackendExecutionAuthority } from './staged-validation.js';

const WORKSPACE_HASH = /^[0-9a-f]{64}$/;

export interface GuestMutationPolicyInput {
  host: ProviderCommandHost;
  allowGuestMutation: boolean;
  workspaceHash?: string;
  executionAuthorityKind: BackendExecutionAuthority['kind'];
  isolatedBackend: boolean;
  /** macOS Seatbelt can safely contain a direct host provider to the
   * admitted worktree. This is the post-DSH normal path. */
  hostContainment?: boolean;
}

/**
 * Codex may mutate only inside a Major-contained host worktree or a
 * quarantined Lima copy, plus an active Supervised Workshop session.
 * Claude/Cursor keep their existing mutation contracts. Antigravity stays
 * read-only. Callers cannot self-authorise by setting the flag.
 */
export function assertGuestMutationPolicy(input: GuestMutationPolicyInput): void {
  if (input.host === 'antigravity' && input.allowGuestMutation) {
    throw new Error('antigravity cannot mutate the quarantined guest workspace');
  }
  if (!input.allowGuestMutation) return;
  if (input.host !== 'codex') return;
  if (!input.workspaceHash || !WORKSPACE_HASH.test(input.workspaceHash)) {
    throw new Error('mutable provider execution requires a source workspace digest');
  }
  if (!input.isolatedBackend && !input.hostContainment) {
    throw new Error('Codex guest mutation requires the Lima execution backend');
  }
  if (input.executionAuthorityKind !== 'supervised_workshop') {
    throw new Error('Codex guest mutation requires active supervised Workshop authority');
  }
}
