import { execFileSync } from 'node:child_process';
import { executeStreaming, type StreamingSpawnSpec } from '../providers/exec.js';
import type { ExecuteHandle } from '../providers/types.js';
import { checkArgv, type CommandPolicy } from './commands.js';
import { sanitizeEnv, type SanitizedEnv } from './env.js';
import { assertWithinRootsCanonical, canonicalize, PathViolationError } from './paths.js';
import { redactText } from './redact.js';

/**
 * The single boundary through which every external process must pass.
 * Provider adapters never spawn independently: they hold a gateway and ask it
 * to execute or probe. The gateway canonicalises paths, enforces the
 * executable/command allowlist, sanitises the environment, redacts what it
 * records, and records every policy decision — allowed or refused.
 */

export interface ExecutionPolicyDecision {
  kind: 'execute' | 'probe';
  allowed: boolean;
  executable: string;
  /** Redacted before recording. */
  argv: string[];
  cwd?: string;
  reason: string;
  strippedEnv: string[];
  authorizedEnv: string[];
  /** DecisionRequest id authorising sensitive env vars, when present. */
  envDecisionId?: string;
  at: string;
}

export type DecisionRecorder = (decision: ExecutionPolicyDecision) => void;

export class GatewayViolationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GatewayViolationError';
  }
}

export interface GatewayExecuteRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  parseLine?: StreamingSpawnSpec['parseLine'];
  detectRateLimit?: StreamingSpawnSpec['detectRateLimit'];
  detectExhaustion?: StreamingSpawnSpec['detectExhaustion'];
  extractSessionRef?: StreamingSpawnSpec['extractSessionRef'];
  extractUsage?: StreamingSpawnSpec['extractUsage'];
}

export interface GatewayOptions {
  /** Mandatory, non-empty for an executing gateway. Canonicalised per call. */
  allowedRoots: readonly string[];
  /** Must carry a non-empty allowedExecutables list. */
  commandPolicy: CommandPolicy;
  /** Base environment (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
  /** Extra non-sensitive env names to pass through. */
  envAllowlist?: readonly string[];
  /** Sensitive env vars require a valid DecisionRequest to pass through. */
  authorizedEnv?: { names: readonly string[]; decisionId: string };
  /** Verifies the authorising DecisionRequest is approved. */
  verifyDecision?: (decisionId: string) => boolean;
  /** Sink for the execution-policy audit trail. Mandatory. */
  recordDecision: DecisionRecorder;
  /** Internal: set only by ExecutionGateway.probeOnly(). */
  probeOnlyInternal?: boolean;
}

/** Argument forms a probe may use; probes are read-only version/auth checks. */
const PROBE_ARG_FORMS: readonly (readonly string[])[] = [
  ['--version'],
  ['-V'],
  ['-v'],
  ['auth', 'status'],
];

const PROBE_TIMEOUT_MS = 20_000;

export class ExecutionGateway {
  private readonly options: GatewayOptions;
  private readonly probeOnly: boolean;

  constructor(options: GatewayOptions) {
    if (!options.probeOnlyInternal && options.allowedRoots.length === 0) {
      throw new GatewayViolationError('allowedRoots is mandatory and must be non-empty');
    }
    const allowed = options.commandPolicy.allowedExecutables;
    if (!allowed || allowed.length === 0) {
      throw new GatewayViolationError('commandPolicy.allowedExecutables is mandatory');
    }
    this.options = options;
    this.probeOnly = Boolean(options.probeOnlyInternal);
  }

  /**
   * A gateway that can only run read-only probes (which/--version/auth
   * status). Used before any project is registered; execute() always refuses.
   */
  static probeOnly(options: Omit<GatewayOptions, 'allowedRoots'>): ExecutionGateway {
    return new ExecutionGateway({ ...options, allowedRoots: [], probeOnlyInternal: true });
  }

  private record(
    decision: Omit<ExecutionPolicyDecision, 'at' | 'argv'> & { argv: readonly string[] },
  ) {
    this.options.recordDecision({
      ...decision,
      argv: decision.argv.map((a) => redactText(a)),
      at: new Date().toISOString(),
    });
  }

  private refuse(
    kind: 'execute' | 'probe',
    request: { executable: string; args: readonly string[]; cwd?: string },
    reason: string,
  ): never {
    const decision: Parameters<typeof this.record>[0] = {
      kind,
      allowed: false,
      executable: request.executable,
      argv: request.args,
      reason,
      strippedEnv: [],
      authorizedEnv: [],
    };
    if (request.cwd !== undefined) decision.cwd = request.cwd;
    this.record(decision);
    throw new GatewayViolationError(reason);
  }

  private buildEnv(
    kind: 'execute' | 'probe',
    request: { executable: string; args: readonly string[]; cwd?: string },
  ): SanitizedEnv {
    const authorizedNames = this.options.authorizedEnv?.names ?? [];
    if (authorizedNames.length > 0) {
      const decisionId = this.options.authorizedEnv!.decisionId;
      const verified = this.options.verifyDecision?.(decisionId) ?? false;
      if (!verified) {
        this.refuse(
          kind,
          request,
          `environment authorisation invalid: DecisionRequest ${decisionId} is not approved`,
        );
      }
    }
    const sanitizeOptions: Parameters<typeof sanitizeEnv>[1] = { authorizedNames };
    if (this.options.envAllowlist !== undefined) {
      sanitizeOptions.allowlist = this.options.envAllowlist;
    }
    return sanitizeEnv(this.options.baseEnv ?? process.env, sanitizeOptions);
  }

  /** Canonicalise + contain + policy-check + sanitise, then spawn streaming. */
  execute(request: GatewayExecuteRequest): ExecuteHandle {
    if (this.probeOnly) {
      this.refuse('execute', request, 'this gateway is probe-only: no allowed roots configured');
    }

    let canonicalCwd: string;
    try {
      canonicalCwd = assertWithinRootsCanonical(request.cwd, this.options.allowedRoots);
    } catch (error) {
      const reason =
        error instanceof PathViolationError ? error.message : 'working directory rejected';
      this.refuse('execute', request, reason);
    }

    // The allowlist applies to the invoked name (bare or path basename);
    // canonicalising here would break npm-shim symlinks (bin -> cli.js).
    // A pathful executable must at least exist.
    const executable = request.executable;
    if (executable.includes('/')) {
      try {
        canonicalize(executable);
      } catch {
        this.refuse('execute', request, `executable does not exist: ${request.executable}`);
      }
    }

    const check = checkArgv(executable, request.args, this.options.commandPolicy);
    if (!check.allowed) this.refuse('execute', request, check.reason);

    const env = this.buildEnv('execute', request);

    this.record({
      kind: 'execute',
      allowed: true,
      executable,
      argv: request.args,
      cwd: canonicalCwd,
      reason: 'allowed',
      strippedEnv: env.stripped,
      authorizedEnv: env.authorized,
      ...(this.options.authorizedEnv
        ? { envDecisionId: this.options.authorizedEnv.decisionId }
        : {}),
    });

    const spec: StreamingSpawnSpec = {
      executable,
      args: [...request.args],
      cwd: canonicalCwd,
      env: env.env,
      allowedRoots: this.options.allowedRoots,
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    if (request.parseLine) spec.parseLine = request.parseLine;
    if (request.detectRateLimit) spec.detectRateLimit = request.detectRateLimit;
    if (request.detectExhaustion) spec.detectExhaustion = request.detectExhaustion;
    if (request.extractSessionRef) spec.extractSessionRef = request.extractSessionRef;
    if (request.extractUsage) spec.extractUsage = request.extractUsage;
    return executeStreaming(spec);
  }

  /**
   * Read-only discovery probe (`which x`, `x --version`, `gh auth status`).
   * Only fixed argument forms are allowed; env is sanitised with no
   * authorised secrets; output is captured, trimmed and returned.
   */
  probeSync(executable: string, args: readonly string[]): string | undefined {
    const base = executable.split('/').at(-1) ?? executable;
    const isWhich =
      base === 'which' && args.length === 1 && /^[A-Za-z0-9._-]+$/.test(args[0] ?? '');
    const isKnownForm =
      (this.options.commandPolicy.allowedExecutables ?? []).includes(base) &&
      PROBE_ARG_FORMS.some(
        (form) => form.length === args.length && form.every((a, i) => a === args[i]),
      );
    if (!isWhich && !isKnownForm) {
      this.refuse('probe', { executable, args }, `probe not allowed: ${base} ${args.join(' ')}`);
    }

    const env = sanitizeEnv(this.options.baseEnv ?? process.env, {
      allowlist: this.options.envAllowlist ?? [],
    });
    this.record({
      kind: 'probe',
      allowed: true,
      executable,
      argv: args,
      reason: 'allowed',
      strippedEnv: env.stripped,
      authorizedEnv: [],
    });
    try {
      const out = execFileSync(executable, [...args], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        env: env.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  }
}
