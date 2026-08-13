import type { ProviderCommandHost } from '../providers/commands.js';
import type { ProviderEvent } from '../providers/types.js';
import type { ProviderApprovalAuthority } from '../security/provider-approval-policy.js';

export interface AgentRuntimeRequest {
  host: ProviderCommandHost;
  prompt: string;
  allowGuestMutation: boolean;
  approvalAuthority: ProviderApprovalAuthority;
  modelRef?: string;
  resumeSessionRef?: string;
  guestRun: string;
  guestHome: string;
  guestWorkspace: string;
  runId: string;
  abortSignal: AbortSignal;
  emit(event: ProviderEvent): void;
}

export interface AgentRuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  sessionRef?: string;
  usage?: unknown;
  modelSelection: 'supported' | 'unsupported';
  requestedModel?: string;
  actualModel?: string;
}

/** Provider protocol boundary below Major policy and above Lima isolation. */
export interface AgentRuntimePort {
  execute(request: AgentRuntimeRequest): Promise<AgentRuntimeResult>;
}
