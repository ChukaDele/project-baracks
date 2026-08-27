import { isAbsolute, resolve } from 'node:path';
import { executeStreaming, type StreamingSpawnSpec } from '../providers/exec.js';
import type { ExecuteHandle } from '../providers/types.js';
import type { ExecutionBackend } from '../execution/backend.js';
import type { BackendProviderRequest } from '../execution/backend.js';
import { CapabilityUnavailableError, isCapabilityAvailable } from './capabilities.js';
import { checkArgv, type CommandPolicy } from './commands.js';
import type { Containment } from './containment.js';
import { sanitizeEnv, type SanitizedEnv } from './env.js';
import {
  assertWithinRootsCanonical,
  canonicalize,
  isWithinRoots,
  PathViolationError,
} from './paths.js';
import { redactText } from './redact.js';
import { verifyProviderApprovalAuthority } from './provider-approval-policy.js';
import type { ApprovalCategory, ProviderApprovalAuthority } from './provider-approval-policy.js';
import { assertGuestMutationPolicy } from './guest-mutation.js';
import type { BackendExecutionAuthority } from './staged-validation.js';
import {
  ExecutableTrustError,
  TrustedExecutableRegistry,
  type TrustedExecutable,
} from './trusted-executables.js';

/**
 * The single boundary through which every external process must pass.
 * Provider adapters never spawn independently: they hold a gateway and ask it
 * to execute or probe.
 *
 * Live execution remains behind the immutable M1 capability constant. Every
 * spawn must pass path confinement, executable identity, argv policy,
 * environment sanitisation and enforced OS containment.
 *
 * Discovery remains RESOLUTION-ONLY and PROCESS-FREE. The
 * gateway exposes exactly one discovery operation — resolveExecutable(), a
 * PATH lookup for reporting — and NO method spawns a process: there is no
 * --version probe, no `which` subprocess, no execFile/spawn anywhere in this
 * file. A resolvable path is reported but confers no execution trust and is
 * never evidence a binary is genuine or runnable; execution trust is granted
 * only by the pinned identity and OS-isolated gateway path.
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
  stagedValidationLeaseId?: string;
  stagedValidationReleaseSha?: string;
  supervisedWorkshopSessionId?: string;
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
  resourceLeaseId?: string;
  executionAuthority?: BackendExecutionAuthority;
  providerRequest?: Omit<BackendProviderRequest, 'approvalAuthority' | 'workshopMode'> & {
    approvalAuthority: ProviderApprovalAuthority;
  };
}

export interface GatewayOptions {
  /** Mandatory, non-empty for an executing gateway. Canonicalised per call. */
  allowedRoots: readonly string[];
  /** Provider/runtime/config roots that may be read but never written. */
  readOnlyRoots?: readonly string[];
  /** Must carry a non-empty allowedExecutables list. */
  commandPolicy: CommandPolicy;
  /**
   * Mandatory trust anchor: every spawn (execute or probe) resolves through
   * this registry, so only canonical installations registered via explicit
   * pinning or supervisor-side PATH discovery can ever run.
   */
  trustedExecutables: TrustedExecutableRegistry;
  /**
   * Containment mechanism applied to every spawned process tree. execute()
   * fails closed when this is absent or not enforced.
   */
  containment?: Containment;
  /** Isolated provider backend. Mutually exclusive with host containment. */
  backend?: ExecutionBackend;
  /** Base environment (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
  /** Extra non-sensitive env names to pass through. */
  envAllowlist?: readonly string[];
  /** Sensitive env vars require a valid DecisionRequest to pass through. */
  authorizedEnv?: { names: readonly string[]; decisionId: string };
  /** Verifies the authorising DecisionRequest is approved. */
  verifyDecision?: (decisionId: string) => boolean;
  /** Verifies provider action authority against durable, scoped decisions. */
  verifyProviderDecision?: (category: ApprovalCategory, decisionId: string) => boolean;
  /** Sink for the execution-policy audit trail. Mandatory. */
  recordDecision: DecisionRecorder;
  /** Internal: set only by ExecutionGateway.probeOnly(). */
  probeOnlyInternal?: boolean;
}

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
    if (!options.trustedExecutables) {
      throw new GatewayViolationError('trustedExecutables registry is mandatory');
    }
    this.options = options;
    this.probeOnly = Boolean(options.probeOnlyInternal);
  }

  /**
   * A gateway restricted to process-free discovery (resolveExecutable). Used
   * before any project is registered; execute() always refuses.
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

  /** Flags whose following argument is a filesystem path (value consumed). */
  private static readonly PATH_VALUE_FLAGS = new Set([
    '-C',
    '--cwd',
    '--directory',
    '--work-tree',
    '--git-dir',
    '-o',
    '--output',
    '--out',
    '-f',
    '--file',
    '--config',
    '--data-dir',
  ]);

  /**
   * Return a violation reason when any argument names a filesystem path that
   * escapes the allowed roots: an absolute path, or the value of a known
   * directory/file flag. Relative candidates resolve against the (already
   * contained) working directory. Non-path arguments (refspecs, model refs,
   * URLs) are left untouched.
   */
  private argPathViolation(args: readonly string[], canonicalCwd: string): string | null {
    const roots = this.options.allowedRoots.flatMap((r) => {
      try {
        return [canonicalize(r)];
      } catch {
        return [r];
      }
    });
    const check = (candidate: string): string | null => {
      const abs = isAbsolute(candidate) ? candidate : resolve(canonicalCwd, candidate);
      // Resolve to a real location when possible so symlinks cannot escape.
      let probe = abs;
      try {
        probe = canonicalize(abs);
      } catch {
        /* non-existent target: fall back to the lexical absolute path */
      }
      return isWithinRoots(probe, roots)
        ? null
        : `path-bearing argument escapes the allowed roots: ${candidate}`;
    };
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (ExecutionGateway.PATH_VALUE_FLAGS.has(arg)) {
        const value = args[i + 1];
        i++;
        if (value !== undefined) {
          const violation = check(value);
          if (violation) return violation;
        }
        continue;
      }
      const eq = arg.indexOf('=');
      if (
        arg.startsWith('--') &&
        eq > 0 &&
        ExecutionGateway.PATH_VALUE_FLAGS.has(arg.slice(0, eq))
      ) {
        const violation = check(arg.slice(eq + 1));
        if (violation) return violation;
        continue;
      }
      if (isAbsolute(arg)) {
        const violation = check(arg);
        if (violation) return violation;
      }
    }
    return null;
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

  /** Execute only through the complete M1 trust and containment boundary. */
  execute(request: GatewayExecuteRequest): ExecuteHandle {
    const stagedAuthority =
      request.executionAuthority?.kind === 'staged_validation'
        ? request.executionAuthority
        : undefined;
    const staged = Boolean(stagedAuthority);
    const workshopAuthority =
      request.executionAuthority?.kind === 'supervised_workshop'
        ? request.executionAuthority
        : undefined;
    const workshop = Boolean(workshopAuthority);
    if (!isCapabilityAvailable('live-agent-execution') && !staged && !workshop) {
      const decision: Parameters<typeof this.record>[0] = {
        kind: 'execute',
        allowed: false,
        executable: request.executable,
        argv: request.args,
        cwd: request.cwd,
        reason: new CapabilityUnavailableError('live-agent-execution').message,
        strippedEnv: [],
        authorizedEnv: [],
      };
      this.record(decision);
      throw new CapabilityUnavailableError('live-agent-execution');
    }

    if (this.probeOnly) {
      this.refuse('execute', request, 'this gateway is probe-only: no allowed roots configured');
    }

    // Fail closed unless a containment mechanism is configured and enforced.
    if (
      !this.options.backend &&
      (!this.options.containment?.enforced ||
        !this.options.containment.filesystemIsolation ||
        !this.options.containment.networkIsolation)
    ) {
      this.refuse(
        'execute',
        request,
        'trusted filesystem and network isolation is not configured or unavailable on this platform',
      );
    }

    let canonicalCwd: string;
    try {
      canonicalCwd = assertWithinRootsCanonical(request.cwd, this.options.allowedRoots);
    } catch (error) {
      const reason =
        error instanceof PathViolationError ? error.message : 'working directory rejected';
      this.refuse('execute', request, reason);
    }

    const check = checkArgv(request.executable, request.args, this.options.commandPolicy);
    if (!check.allowed) this.refuse('execute', request, check.reason);

    if (request.providerRequest) {
      try {
        assertGuestMutationPolicy({
          host: request.providerRequest.host,
          allowGuestMutation: request.providerRequest.allowGuestMutation,
          ...(request.providerRequest.workspaceHash
            ? { workspaceHash: request.providerRequest.workspaceHash }
            : {}),
          executionAuthorityKind: request.executionAuthority?.kind ?? 'supervised',
          isolatedBackend: this.options.backend?.kind === 'lima',
          hostContainment:
            !this.options.backend &&
            Boolean(
              this.options.containment?.enforced &&
              this.options.containment.filesystemIsolation &&
              this.options.containment.networkIsolation,
            ),
        });
      } catch (error) {
        this.refuse(
          'execute',
          request,
          error instanceof Error ? error.message : 'guest mutation policy rejected execution',
        );
      }
    }

    // Confine path-bearing arguments (absolute paths and tool directory flags
    // such as -C/--work-tree/--output) to the allowed roots, so a trusted
    // binary cannot be aimed at the filesystem outside the roots.
    const argViolation = this.argPathViolation(request.args, canonicalCwd);
    if (argViolation) this.refuse('execute', request, argViolation);

    // Bind the spawn to a trusted canonical installation: the allowlist name
    // must have a registered binding, and a path-qualified request must
    // realpath-resolve to that exact identity. What actually spawns is the
    // trusted spawn path — never the caller's string.
    let trusted: TrustedExecutable | undefined;
    if (!this.options.backend) {
      try {
        trusted = this.options.trustedExecutables.verify(request.executable);
      } catch (error) {
        const reason =
          error instanceof ExecutableTrustError ? error.message : 'executable trust check failed';
        this.refuse('execute', request, reason);
      }
    }

    const env = this.buildEnv('execute', request);

    if (this.options.backend) {
      if (!request.providerRequest) {
        this.refuse(
          'execute',
          request,
          'isolated provider execution requires a structured Major provider request',
        );
      }
      let verifiedProviderRequest: BackendProviderRequest;
      try {
        if (!this.options.verifyProviderDecision) {
          this.refuse('execute', request, 'provider decision verifier is unavailable');
        }
        const verifiedAuthority = verifyProviderApprovalAuthority(
          request.providerRequest.host,
          request.providerRequest.approvalAuthority,
          this.options.verifyProviderDecision,
        );
        verifiedProviderRequest = {
          ...request.providerRequest,
          approvalAuthority: verifiedAuthority,
          ...(workshop ? { workshopMode: true } : {}),
        };
      } catch (error) {
        this.refuse(
          'execute',
          request,
          error instanceof Error ? error.message : 'provider approval policy rejected execution',
        );
      }
      this.record({
        kind: 'execute',
        allowed: true,
        executable: request.executable,
        argv: request.args,
        cwd: canonicalCwd,
        reason: `allowed via ${this.options.backend.kind} backend`,
        strippedEnv: env.stripped,
        authorizedEnv: env.authorized,
        ...(staged
          ? {
              stagedValidationLeaseId: stagedAuthority!.leaseId,
              stagedValidationReleaseSha: stagedAuthority!.releaseSha,
            }
          : {}),
        ...(workshop ? { supervisedWorkshopSessionId: workshopAuthority!.sessionId } : {}),
        ...(this.options.authorizedEnv
          ? { envDecisionId: this.options.authorizedEnv.decisionId }
          : {}),
      });
      return this.options.backend.execute({
        executionAuthority: request.executionAuthority ?? { kind: 'supervised' },
        executable: request.executable,
        args: request.args,
        cwd: canonicalCwd,
        allowedRoots: this.options.allowedRoots,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        ...(request.parseLine ? { parseLine: request.parseLine } : {}),
        ...(request.detectRateLimit ? { detectRateLimit: request.detectRateLimit } : {}),
        ...(request.detectExhaustion ? { detectExhaustion: request.detectExhaustion } : {}),
        ...(request.extractSessionRef ? { extractSessionRef: request.extractSessionRef } : {}),
        ...(request.extractUsage ? { extractUsage: request.extractUsage } : {}),
        ...(request.resourceLeaseId ? { resourceLeaseId: request.resourceLeaseId } : {}),
        providerRequest: verifiedProviderRequest,
      });
    }

    let wrapped: ReturnType<Containment['wrap']>;
    try {
      wrapped = this.options.containment!.wrap({
        executable: trusted!.canonicalPath,
        canonicalExecutable: trusted!.canonicalPath,
        args: request.args,
        allowedRoots: this.options.allowedRoots,
        ...(this.options.readOnlyRoots ? { readOnlyRoots: this.options.readOnlyRoots } : {}),
      });
    } catch (error) {
      this.refuse(
        'execute',
        request,
        `execution containment could not be applied: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.record({
      kind: 'execute',
      allowed: true,
      executable: trusted!.spawnPath,
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
      executable: wrapped.executable,
      args: wrapped.args,
      cwd: canonicalCwd,
      env: env.env,
      allowedRoots: this.options.allowedRoots,
      // Process-tree containment: spawn as a group leader so the whole
      // descendant tree is terminated together (never only the direct child).
      detached: true,
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    if (request.parseLine) spec.parseLine = request.parseLine;
    if (request.detectRateLimit) spec.detectRateLimit = request.detectRateLimit;
    if (request.detectExhaustion) spec.detectExhaustion = request.detectExhaustion;
    if (request.extractSessionRef) spec.extractSessionRef = request.extractSessionRef;
    if (request.extractUsage) spec.extractUsage = request.extractUsage;
    return executeStreaming(spec, request.executionAuthority);
  }

  /**
   * Resolve an executable NAME to a path on PATH, for REPORTING ONLY. This is
   * the entire process-free discovery surface, and it is
   * PROCESS-FREE: it performs a supervisor-side PATH lookup (filesystem
   * metadata only) and never runs anything — no --version, no `which`
   * subprocess, no execFile/spawn. A path-qualified argument is rejected: only
   * bare names on the discovery allowlist are resolved, so an
   * environment/PATH-selected executable override can never be turned into a
   * spawn here.
   *
   * A resolved path is reported (e.g. by doctor) but confers NO execution
   * trust and is NOT evidence the binary is genuine, installed or runnable —
   * that requires the trusted, OS-isolated execution boundary of milestone M1.
   * Returns the resolved path, or undefined when the name is not on PATH.
   */
  resolveExecutable(name: string): string | undefined {
    if (name.includes('/')) {
      this.refuse(
        'probe',
        { executable: name, args: [] },
        `discovery is name-only (resolution-only): a path-qualified target is refused: ${name}`,
      );
    }
    if (!(this.options.commandPolicy.allowedExecutables ?? []).includes(name)) {
      this.refuse('probe', { executable: name, args: [] }, `discovery not allowed: ${name}`);
    }
    const env = sanitizeEnv(this.options.baseEnv ?? process.env, {
      allowlist: this.options.envAllowlist ?? [],
    });
    // Resolution only: a previously trusted binding's path, else a PATH scan
    // for reporting. Neither spawns; both are pure filesystem inspection.
    const resolved =
      this.options.trustedExecutables.get(name)?.spawnPath ??
      this.options.trustedExecutables.resolveForReport(name, env.env.PATH);
    this.record({
      kind: 'probe',
      allowed: true,
      executable: name,
      argv: [],
      reason: resolved ? `resolved ${name} -> ${resolved}` : `not found on PATH: ${name}`,
      strippedEnv: env.stripped,
      authorizedEnv: [],
    });
    return resolved;
  }
}
