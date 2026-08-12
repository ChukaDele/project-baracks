import type { ExecuteHandle, ProviderEvent } from '../providers/types.js';
import type { ProviderCommandHost } from '../providers/commands.js';
import type { ProviderApprovalAuthority } from '../security/provider-approval-policy.js';

export interface BackendProviderRequest {
  host: ProviderCommandHost;
  prompt: string;
  /** Set only after Major policy authorises mutation of the quarantined guest copy. */
  allowGuestMutation: boolean;
  /** Major-owned authority. An empty set means no sensitive tool action is approved. */
  approvalAuthority: ProviderApprovalAuthority;
  modelRef?: string;
  resumeSessionRef?: string;
}

export interface BackendExecuteRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedRoots: readonly string[];
  timeoutMs?: number;
  parseLine?: (line: string) => ProviderEvent | null;
  detectRateLimit?: (text: string) => boolean;
  detectExhaustion?: (text: string) => boolean;
  /** Extract provider evidence from the same structured event stream returned to callers. */
  extractSessionRef?: (event: ProviderEvent) => string | undefined;
  extractUsage?: (event: ProviderEvent) => unknown;
  resourceLeaseId?: string;
  /** Structured provider intent. Required by protocol-aware isolated backends. */
  providerRequest?: BackendProviderRequest;
}

export interface BackendStatus {
  kind: string;
  available: boolean;
  filesystemIsolation: boolean;
  networkIsolation: boolean;
  lifecycleIsolation: boolean;
  detail: string;
}

export interface BackendProviderStatus {
  executable: string;
  installed: boolean;
  authenticated: boolean;
  detail: string;
}

/** The sole execution boundary below Major's policy gateway. */
export interface ExecutionBackend {
  readonly kind: string;
  inspect(): Promise<BackendStatus>;
  probeProvider(executable: string): Promise<BackendProviderStatus>;
  execute(request: BackendExecuteRequest): ExecuteHandle;
}
