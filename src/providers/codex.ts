import type { ExecutionGateway } from '../security/gateway.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';
import { EXHAUSTION_PATTERN, providerExecuteArgs, RATE_LIMIT_PATTERN } from './commands.js';

/** Canonical executable name resolved for reporting. Environment overrides are
 * deliberately NOT consulted for discovery in this build. */
const CODEX_EXECUTABLE = 'codex';

export interface CodexOptions {
  /** Every spawn — probe or execution — goes through this gateway. */
  gateway: ExecutionGateway;
  executable?: string;
  registry?: ModelRegistry;
}

export class CodexProvider implements ProviderAdapter {
  readonly name = 'codex';
  private readonly gateway: ExecutionGateway;
  private readonly executable: string;
  private readonly registry: ModelRegistry;

  constructor(options: CodexOptions) {
    this.gateway = options.gateway;
    // The explicit executable is used only by the contained execute path;
    // discovery never consults it. Environment overrides
    // (MAJOR_CODEX_BIN) are ignored entirely.
    this.executable = options.executable ?? CODEX_EXECUTABLE;
    this.registry = options.registry ?? loadModelRegistry();
  }

  async discover(): Promise<ProviderInfo> {
    // Discovery is RESOLUTION-ONLY and PROCESS-FREE. The
    // CLI is never executed — no --version, no `which` subprocess, no spawn —
    // so we cannot verify that a resolvable binary is genuine, installed or
    // runnable; that requires a separate OS-isolated execution probe. Only the
    // canonical name is resolved on PATH for reporting; environment overrides
    // are ignored for discovery and never touched.
    const resolved = this.gateway.resolveExecutable(CODEX_EXECUTABLE);
    const info: ProviderInfo = {
      name: this.name,
      // Cannot be confirmed without executing the binary → reported truthfully
      // as unverified, never as installed/authenticated/available.
      installed: false,
      authenticated: false,
      executableUnverified: true,
      models: registryModels(this.registry, this.name, { visible: false, authenticated: false }),
    };
    if (resolved !== undefined) info.executable = resolved;
    return info;
  }

  async probe(): Promise<ProviderInfo> {
    // Deliberately identical to discover(): resolution-only, process-free.
    return this.discover();
  }

  /** Execute through the trusted, OS-contained gateway. */
  execute(request: ExecuteRequest): ExecuteHandle {
    const args = providerExecuteArgs('codex', request);
    const spec: Parameters<ExecutionGateway['execute']>[0] = {
      // The gateway resolves this through the trusted-executable registry;
      // an unregistered or shadowed installation is refused at spawn time.
      executable: this.executable,
      args,
      cwd: request.cwd,
      detectRateLimit: (text) => RATE_LIMIT_PATTERN.test(text),
      detectExhaustion: (text) => EXHAUSTION_PATTERN.test(text),
      extractSessionRef: (event) => {
        const data = event.data as
          { session_id?: string; thread_id?: string; msg?: { session_id?: string } } | undefined;
        return data?.session_id ?? data?.thread_id ?? data?.msg?.session_id;
      },
      extractUsage: (event) => {
        const data = event.data as { msg?: { type?: string; info?: unknown } } | undefined;
        return data?.msg?.type === 'token_count' ? data.msg.info : undefined;
      },
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    return this.gateway.execute(spec);
  }
}
