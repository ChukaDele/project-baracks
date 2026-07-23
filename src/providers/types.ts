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
  /** Path resolved on PATH for REPORTING ONLY. Not evidence of installation:
   * in the disabled foundation the binary is never executed, so a resolvable
   * path is unverified. */
  executable?: string;
  version?: string;
  installed: boolean;
  /** Best-effort. Undefined when authentication state is not detectable. */
  authenticated?: boolean;
  /** True in the disabled foundation: executable availability could not be
   * verified because verifying it requires executing the binary (deferred to
   * milestone M1 — trusted OS-isolated execution). Presence on PATH is
   * reported via `executable`, but is never treated as installed/available. */
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
}

export interface ProviderEvent {
  type: string;
  data: unknown;
}

export interface ExecuteOutcome {
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  exitCode: number | null;
  sessionRef?: string;
  /** Raw usage payload captured from the provider's result event, if any. */
  usage?: unknown;
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
