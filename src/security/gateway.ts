import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { executeStreaming, type StreamingSpawnSpec } from '../providers/exec.js';
import type { ExecuteHandle } from '../providers/types.js';
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
 * IN THIS BUILD, execute() IS DISABLED. Live agent execution is an
 * unavailable capability (src/security/capabilities.ts): every call records a
 * refusal and throws CapabilityUnavailableError before any validation or
 * spawn, unconditionally — no configuration, environment variable or
 * constructor option can pass the gate. Only read-only discovery probes
 * (probeSync) and trusted-installation pinning remain runnable.
 *
 * The validation pipeline below the gate (path canonicalisation, trusted
 * executable binding, argv policy, path-argument confinement, environment
 * sanitisation, process-group containment) is retained as the starting point
 * for milestone M1 (docs/deferred-security-milestones.md). It is groundwork,
 * not a complete boundary: independent review found the executable identity
 * check skips content hashing when file metadata appears unchanged, and no
 * OS-level filesystem/network isolation is enforced. It must not be presented
 * or relied on as a production execution boundary until M1 closes those gaps
 * and is independently reviewed.
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
  /**
   * Mandatory trust anchor: every spawn (execute or probe) resolves through
   * this registry, so only canonical installations registered via explicit
   * pinning or supervisor-side PATH discovery can ever run.
   */
  trustedExecutables: TrustedExecutableRegistry;
  /**
   * Containment mechanism applied to every spawned process tree. execute()
   * fails closed when this is absent or not enforced — the fail-closed gate
   * that keeps live agent execution disabled until real containment exists.
   */
  containment?: Containment;
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
    if (!options.trustedExecutables) {
      throw new GatewayViolationError('trustedExecutables registry is mandatory');
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

  /**
   * QUARANTINED — always refuses. Live agent execution is unavailable in this
   * build: the gate below records the refusal and throws before any spawn can
   * occur, regardless of how the gateway was configured. The validation and
   * spawn pipeline after the gate is retained, compiled and type-checked as
   * the M1 starting point, but is unreachable until that milestone lands.
   */
  execute(request: GatewayExecuteRequest): ExecuteHandle {
    if (!isCapabilityAvailable('live-agent-execution')) {
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
    if (!this.options.containment?.enforced) {
      this.refuse(
        'execute',
        request,
        'execution containment is not configured or unavailable on this platform: ' +
          'live execution is disabled',
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

    // Confine path-bearing arguments (absolute paths and tool directory flags
    // such as -C/--work-tree/--output) to the allowed roots, so a trusted
    // binary cannot be aimed at the filesystem outside the roots.
    const argViolation = this.argPathViolation(request.args, canonicalCwd);
    if (argViolation) this.refuse('execute', request, argViolation);

    // Bind the spawn to a trusted canonical installation: the allowlist name
    // must have a registered binding, and a path-qualified request must
    // realpath-resolve to that exact identity. What actually spawns is the
    // trusted spawn path — never the caller's string.
    let trusted: TrustedExecutable;
    try {
      trusted = this.options.trustedExecutables.verify(request.executable);
    } catch (error) {
      const reason =
        error instanceof ExecutableTrustError ? error.message : 'executable trust check failed';
      this.refuse('execute', request, reason);
    }

    const env = this.buildEnv('execute', request);

    this.record({
      kind: 'execute',
      allowed: true,
      executable: trusted.spawnPath,
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
      executable: trusted.spawnPath,
      args: [...request.args],
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
    return executeStreaming(spec);
  }

  /**
   * Pin an explicitly configured installation path as the trusted canonical
   * installation for its basename. Returns the spawnable path, or undefined
   * when the path is not a valid executable (recorded either way).
   */
  pinExecutable(path: string): string | undefined {
    try {
      const trusted = this.options.trustedExecutables.pin(path);
      this.record({
        kind: 'probe',
        allowed: true,
        executable: path,
        argv: [],
        reason: `pinned trusted executable ${trusted.name} -> ${trusted.canonicalPath}`,
        strippedEnv: [],
        authorizedEnv: [],
      });
      return trusted.spawnPath;
    } catch (error) {
      this.record({
        kind: 'probe',
        allowed: false,
        executable: path,
        argv: [],
        reason: error instanceof Error ? error.message : 'pin failed',
        strippedEnv: [],
        authorizedEnv: [],
      });
      return undefined;
    }
  }

  /**
   * Read-only discovery probe (`which x`, `x --version`, `gh auth status`).
   * Only fixed argument forms are allowed; env is sanitised with no
   * authorised secrets; output is captured, trimmed and returned.
   *
   * `which` never spawns: it is resolved supervisor-side over the sanitised
   * PATH and the result is registered as the trusted canonical installation.
   * Every other probe form only ever runs a trusted installation.
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

    if (isWhich) {
      // `which` is read-only reporting: resolve on PATH (trusted binding first)
      // WITHOUT conferring execution trust. The result must never be spawned by
      // execute() — only verify()'d bindings are spawnable there.
      const target = args[0]!;
      const resolved =
        this.options.trustedExecutables.get(target)?.spawnPath ??
        this.options.trustedExecutables.resolveForReport(target, env.env.PATH);
      this.record({
        kind: 'probe',
        allowed: true,
        executable,
        argv: args,
        reason: resolved ? `resolved ${target} -> ${resolved}` : `not found on PATH: ${target}`,
        strippedEnv: env.stripped,
        authorizedEnv: [],
      });
      return resolved;
    }

    // A read-only version/auth probe. Probes are NOT the adversarial execute
    // boundary (execution trust, identity revalidation and containment are
    // enforced only in execute()); they run a fixed, read-only argument form.
    // A path-qualified probe target (e.g. a `which`-resolved path) is run as
    // given; a bare name is resolved on PATH for reporting.
    let spawnPath: string | undefined;
    if (executable.includes('/')) {
      spawnPath = executable;
    } else {
      spawnPath =
        this.options.trustedExecutables.get(base)?.spawnPath ??
        this.options.trustedExecutables.resolveForReport(base, env.env.PATH);
      if (!spawnPath) {
        this.record({
          kind: 'probe',
          allowed: true,
          executable,
          argv: args,
          reason: `not found on PATH: ${base}`,
          strippedEnv: env.stripped,
          authorizedEnv: [],
        });
        return undefined;
      }
    }

    this.record({
      kind: 'probe',
      allowed: true,
      executable: spawnPath,
      argv: args,
      reason: 'allowed',
      strippedEnv: env.stripped,
      authorizedEnv: [],
    });
    try {
      const out = execFileSync(spawnPath, [...args], {
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
