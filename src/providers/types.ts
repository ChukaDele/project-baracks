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
  billingMode: BillingMode;
  prohibited: boolean;
  prohibitedReason?: string;
  /** Where this knowledge came from: 'registry' config, 'cli' discovery, or 'probe'. */
  source: 'registry' | 'cli' | 'probe';
}

export interface ProviderInfo {
  name: string;
  executable?: string;
  version?: string;
  installed: boolean;
  /** Best-effort. Undefined when authentication state is not detectable. */
  authenticated?: boolean;
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
