import type { BillingMode, ModelAvailability, RoutingClass } from '../db/schema.js';

/**
 * A model as currently known to Major. The dimensions are deliberately
 * orthogonal: a model can be visible but unauthenticated, authenticated but
 * rate-limited, available but only via API billing, etc.
 */
export interface ModelState {
  modelRef: string;
  routingClass: RoutingClass;
  visible: boolean;
  authenticated: boolean;
  availability: ModelAvailability;
  /** A persisted rate-limit/exhaustion backoff has elapsed, so one real run
   * may retry the model and record a new authoritative outcome. */
  retryEligible?: boolean;
  /** Authoritative billing state. 'unknown' (unroutable) until a human
   * attestation or observed run outcome proves it — configuration defaults
   * never populate this field. */
  billingMode: BillingMode;
  /** What configuration EXPECTS billing to be; display/diagnostic only,
   * never consulted by routing. */
  expectedBillingMode?: BillingMode;
  prohibited: boolean;
  prohibitedReason?: string;
  /** Where this knowledge came from: 'registry' config, 'cli' discovery,
   * 'probe', or the persisted observation store ('persisted'). */
  source: 'registry' | 'cli' | 'probe' | 'persisted';
}

export interface ProviderInfo {
  name: string;
  /** Path resolved on PATH for reporting only. Resolution is not evidence that
   * the executable is genuine or runnable. */
  executable?: string;
  version?: string;
  installed: boolean;
  /** Best-effort. Undefined when authentication state is not detectable. */
  authenticated?: boolean;
  /** Executable availability has not been verified by a contained provider
   * probe. Presence on PATH is reported but is not treated as installed. */
  executableUnverified?: boolean;
  models: ModelState[];
}

export interface ExecuteRequest {
  prompt: string;
  cwd: string;
  modelRef?: string;
  timeoutMs?: number;
  /** Resume a previous session where the provider supports it. */
  resumeSessionRef?: string;
  /** Named subscription account. Omitted means the default account. */
  accountLabel?: string;
}

export interface ProviderEvent {
  type: string;
  data: unknown;
}

export interface ExecuteOutcome {
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  /** Stable backend-owned run identity, when execution left the host process. */
  runId?: string;
  /** Machine-readable failure category for recovery and audit. */
  errorKind?:
    | 'unavailable'
    | 'spawn_failed'
    | 'auth_failed'
    | 'protocol_invalid'
    | 'provider_failed'
    | 'interrupted'
    | 'timed_out'
    | 'cancelled'
    | 'cleanup_failed';
  cleanup?: 'complete' | 'failed';
  exitCode: number | null;
  sessionRef?: string;
  /** Raw usage payload captured from the provider's result event, if any. */
  usage?: unknown;
  /** Runtime-observed support. Absence means the backend did not report the capability. */
  modelSelection?: 'supported' | 'unsupported';
  requestedModel?: string;
  /** Provider-reported or protocol-confirmed model. Never inferred from the request. */
  actualModel?: string;
  rateLimited: boolean;
  exhausted: boolean;
  /** Redacted tail of stderr for diagnostics. */
  stderrTail?: string;
}

export interface ExecuteHandle {
  events: AsyncIterable<ProviderEvent>;
  cancel(): void;
  outcome: Promise<ExecuteOutcome>;
}

/** Contract every agent provider (Claude Code, Codex, future CLIs) implements. */
export interface ProviderAdapter {
  readonly name: string;
  /** Locate the executable, read its version, enumerate known models. */
  discover(): Promise<ProviderInfo>;
  /** Cheap, side-effect-free availability re-check. */
  probe(): Promise<ProviderInfo>;
  /** Non-interactive execution with streamed structured events. */
  execute(request: ExecuteRequest): ExecuteHandle;
}
