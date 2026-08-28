import type { ExecuteHandle, ProviderEvent } from '../providers/types.js';
import type { ProviderCommandHost } from '../providers/commands.js';
import type { CodexUsageAccount } from '../providers/codex-usage.js';
import type { VerifiedProviderApprovalAuthority } from '../security/provider-approval-policy.js';
import type { BackendExecutionAuthority } from '../security/staged-validation.js';

export interface BackendProviderRequest {
  host: ProviderCommandHost;
  prompt: string;
  /** Set only after Major policy authorises mutation of the quarantined guest copy. */
  allowGuestMutation: boolean;
  /** Internal source-tree digest. Required before a mutable guest may copy back. */
  workspaceHash?: string;
  /** Major-owned authority. An empty set means no sensitive tool action is approved. */
  approvalAuthority: VerifiedProviderApprovalAuthority;
  /** Set only by Major after a live session-scoped Workshop authority is verified. */
  workshopMode?: boolean;
  modelRef?: string;
  resumeSessionRef?: string;
  /** Named subscription account for this host. Omitted means the default account. */
  accountLabel?: string;
}

export interface BackendExecuteRequest {
  /** M1-supervised authority or a one-use admitted staged-validation lease. */
  executionAuthority: BackendExecutionAuthority;
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
  resourceLeaseFencingToken?: string;
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
  /** The provider CLI's own reported version inside the isolated worker, for
   * the host/guest compatibility diagnostic in `major provider connect`.
   * Undefined when it couldn't be determined -- never a guess. */
  version?: string;
}

/** The sole execution boundary below Major's policy gateway. */
export interface ExecutionBackend {
  readonly kind: string;
  inspect(): Promise<BackendStatus>;
  probeProvider(executable: string): Promise<BackendProviderStatus>;
  /** Read-only Codex quota snapshot. Must not mutate routing or credentials. */
  readCodexUsage(accountLabels: readonly string[]): Promise<CodexUsageAccount[]>;
  execute(request: BackendExecuteRequest): ExecuteHandle;
}
