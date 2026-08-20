import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { providerExecutable } from '../providers/commands.js';
import {
  accountAuthStoreRelativePath,
  assertAccountLabel,
  DEFAULT_ACCOUNT_LABEL,
  providerStateAccountArgs,
} from '../providers/account.js';
import {
  CODEX_APP_SERVER_READY_DELAY_MS,
  CODEX_APP_SERVER_STARTUP_DELAY_MS,
  queryCodexAppServer,
  type CodexAppServerSnapshot,
} from '../providers/codex-app-server.js';
import { redactCodexUsageText, type CodexUsageAccount } from '../providers/codex-usage.js';
import { hostCredentialPath as expectedHostCredentialPath } from '../providers/host-credential.js';
import type { ExecuteHandle, ExecuteOutcome, ProviderEvent } from '../providers/types.js';
import { openDb } from '../db/client.js';
import { isCapabilityAvailable } from '../security/capabilities.js';
import { darwinSeatbeltContainment } from '../security/containment.js';
import { globalStopRequested } from '../supervisor/policy.js';
import { redactText } from '../security/redact.js';
import { TrustedExecutableRegistry } from '../security/trusted-executables.js';
import { validateVerifiedProviderApprovalAuthority } from '../security/provider-approval-policy.js';
import {
  assertStagedValidationCaseRequest,
  consumeStagedValidationExecution,
  getStagedValidationLease,
  stagedValidationRequestDigest,
} from '../security/staged-validation.js';
import { verifySecureEnclaveStagedValidationAuthority } from '../security/secure-enclave-attestation.js';
import {
  assertActiveResourceLease,
  assertActiveResourceLeaseForProcess,
} from '../supervisor/resources.js';
import { assertSupervisedWorkshopAuthority } from '../security/supervised-workshop.js';
import { assertGuestMutationPolicy } from '../security/guest-mutation.js';
import type {
  BackendExecuteRequest,
  BackendProviderStatus,
  BackendStatus,
  ExecutionBackend,
} from './backend.js';
import type { AgentRuntimeResult } from './agent-runtime.js';
import { CursorAcpRuntime } from './cursor-acp-runtime.js';
import type { LimaExecutionConfig } from './lima-config.js';
import { validateResolvedLimaInstance, type ValidatedLimaInstance } from './lima-invariants.js';
import {
  guestProjectHome,
  guestProviderProfile,
  type GuestProviderProfile,
} from './provider-profile.js';
import { pendingRunManifests, writeRunManifest, type LimaRunManifest } from './run-manifest.js';
import { createReclaimTools } from '../resources/tools.js';
import { productionCleanupDeps, reconcileResources } from '../resources/reconcile.js';
import {
  hashWorkspaceTree,
  snapshotWorkspace,
  validateWorkspaceTree,
} from './workspace-transfer.js';

class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Codex's JSON-mode usage-limit/rate-limit errors arrive as structured events
 * on stdout (e.g. {"type":"error","message":"You've hit your usage
 * limit..."}), never mirrored to stderr. Scanning stderr alone let a real,
 * confirmed exhaustion event pass through as exhausted:false. Scan stdout
 * first, then stderr, so a provider that does use stderr stays covered too.
 */
export function detectProviderOutcomeSignals(
  provider: Pick<CommandResult, 'stdout' | 'stderr'>,
  detect: {
    detectRateLimit?: (text: string) => boolean;
    detectExhaustion?: (text: string) => boolean;
  },
): { rateLimited: boolean; exhausted: boolean } {
  return {
    rateLimited:
      (detect.detectRateLimit?.(provider.stdout) || detect.detectRateLimit?.(provider.stderr)) ??
      false,
    exhausted:
      (detect.detectExhaustion?.(provider.stdout) || detect.detectExhaustion?.(provider.stderr)) ??
      false,
  };
}

function majorHome(): string {
  return process.env.MAJOR_HOME ? resolve(process.env.MAJOR_HOME) : join(homedir(), '.major');
}

function safeGuestRunPath(root: string, provider: string, runId: string): string {
  if (
    !/^\/[A-Za-z0-9._/-]+$/.test(root) ||
    !/^(claude|codex|cursor|antigravity)$/.test(provider) ||
    !/^[a-f0-9-]{36}$/.test(runId)
  ) {
    throw new Error('unsafe guest run path');
  }
  return `${root.replace(/\/$/, '')}/${provider}/${runId}`;
}

function supportedVersion(output: string): boolean {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  return Number(match[1]) === 2 && Number(match[2]) === 2;
}

function errorKind(error: unknown): NonNullable<ExecuteOutcome['errorKind']> {
  const message = error instanceof Error ? error.message : String(error);
  if (/cleanup failed/i.test(message)) return 'cleanup_failed';
  if (/auth|log.?in|credential/i.test(message)) return 'auth_failed';
  if (/unsupported Lima|required Lima instance is absent|not found/i.test(message))
    return 'unavailable';
  if (/spawn|ENOENT/i.test(message)) return 'spawn_failed';
  if (/protocol|malformed|parse/i.test(message)) return 'protocol_invalid';
  return 'provider_failed';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown backend error';
}

function usageScratchHome(runId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('unsafe Codex usage scratch id');
  return `/tmp/major-codex-usage-${runId}`;
}

function canonicalCodexAuthPath(accountLabel: string): string {
  const relative = accountAuthStoreRelativePath('.codex/auth.json', accountLabel);
  const path = `/var/lib/major/provider-auth/codex/${relative}`;
  if (path.includes('..') || !path.startsWith('/var/lib/major/provider-auth/codex/')) {
    throw new Error('unsafe Codex credential path');
  }
  return path;
}

export class LimaBackend implements ExecutionBackend {
  readonly kind = 'lima';
  private readonly registry: TrustedExecutableRegistry;
  private activeChild: ChildProcess | undefined;
  private cancelled = false;
  private activeAbort: AbortController | undefined;
  private forceStopRequired = false;

  constructor(private readonly config: LimaExecutionConfig) {
    this.registry = new TrustedExecutableRegistry({ allowedDirs: [dirname(config.limactlPath)] });
    this.registry.pin(config.limactlPath);
  }

  private hostEnv(): NodeJS.ProcessEnv {
    return {
      HOME: homedir(),
      PATH: `${dirname(this.config.limactlPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'C.UTF-8',
    };
  }

  private run(
    executable: string,
    args: readonly string[],
    onLine?: (line: string) => void,
    cwd?: string,
    env: NodeJS.ProcessEnv = this.hostEnv(),
    input?: Buffer,
  ) {
    return new Promise<CommandResult>((resolvePromise, reject) => {
      let stdout = '';
      let stderr = '';
      let pending = '';
      const child = spawn(executable, [...args], {
        env,
        stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: false,
        detached: true,
        ...(cwd ? { cwd } : {}),
      });
      this.activeChild = child;
      if (!child.stdout || !child.stderr) {
        child.kill();
        reject(new Error('child process output pipes are unavailable'));
        return;
      }
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
        if (!onLine) return;
        pending += text;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
      });
      if (input && child.stdin) {
        child.stdin.on('error', (error) => {
          stderr += `stdin transfer failed: ${error.message}`;
        });
        child.stdin.end(input);
      }
      child.once('error', reject);
      child.once('close', (code) => {
        if (pending && onLine) onLine(pending);
        if (this.activeChild === child) this.activeChild = undefined;
        resolvePromise({ code, stdout, stderr });
      });
    });
  }

  private async runContainedJssValidation(source: string, runRoot: string): Promise<void> {
    const validationRoot = join(runRoot, 'validation');
    const workspace = join(validationRoot, 'workspace');
    const syntheticHome = join(validationRoot, 'home');
    mkdirSync(syntheticHome, { recursive: true, mode: 0o700 });
    snapshotWorkspace(source, workspace);
    const runtime = [
      { node: '/opt/homebrew/bin/node', npm: '/opt/homebrew/bin/npm' },
      { node: '/usr/local/bin/node', npm: '/usr/local/bin/npm' },
    ].find((candidate) => existsSync(candidate.node) && existsSync(candidate.npm));
    if (!runtime) throw new Error('contained JSS Node runtime is unavailable');
    const node = realpathSync(runtime.node);
    const npmCli = realpathSync(runtime.npm);
    const npmRoot = resolve(dirname(npmCli), '..');
    const containment = darwinSeatbeltContainment();
    if (!containment.enforced) throw new Error('JSS field validation containment is unavailable');
    const env = {
      HOME: syntheticHome,
      TMPDIR: join(syntheticHome, 'tmp'),
      npm_config_cache: join(syntheticHome, '.npm'),
      PATH: `${dirname(node)}:/usr/bin:/bin`,
      LANG: 'C.UTF-8',
    };
    mkdirSync(env.TMPDIR, { recursive: true, mode: 0o700 });
    const install = containment.wrap({
      executable: node,
      canonicalExecutable: node,
      args: [npmCli, 'ci', '--ignore-scripts'],
      allowedRoots: [validationRoot],
      readOnlyRoots: [node, npmRoot],
      allowNetworkOutbound: true,
      allowCredentialServices: false,
      allowProcessSignals: false,
    });
    const installed = await this.run(install.executable, install.args, undefined, workspace, env);
    if (installed.code !== 0) {
      throw new Error(`contained JSS dependency install failed: ${redactText(installed.stderr)}`);
    }
    const test = containment.wrap({
      executable: node,
      canonicalExecutable: node,
      args: [npmCli, 'test'],
      allowedRoots: [validationRoot],
      readOnlyRoots: [node, npmRoot],
      allowNetworkOutbound: false,
      allowCredentialServices: false,
      allowProcessSignals: false,
    });
    const tested = await this.run(test.executable, test.args, undefined, workspace, env);
    if (tested.code !== 0) {
      throw new Error(`contained JSS project tests failed: ${redactText(tested.stderr)}`);
    }
  }

  private async runToFile(
    executable: string,
    args: readonly string[],
    output: string,
    cwd?: string,
  ) {
    const fd = openSync(output, 'wx', 0o600);
    try {
      return await new Promise<CommandResult>((resolvePromise, reject) => {
        let stderr = '';
        const child = spawn(executable, [...args], {
          env: this.hostEnv(),
          stdio: ['ignore', fd, 'pipe'],
          shell: false,
          detached: true,
          ...(cwd ? { cwd } : {}),
        });
        this.activeChild = child;
        child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        child.once('error', reject);
        child.once('close', (code) => {
          if (this.activeChild === child) this.activeChild = undefined;
          resolvePromise({ code, stdout: '', stderr });
        });
      });
    } finally {
      closeSync(fd);
    }
  }

  private async lima(args: readonly string[], onLine?: (line: string) => void) {
    const trusted = this.registry.verify(basename(this.config.limactlPath));
    return this.run(trusted.spawnPath, args, onLine);
  }

  private async limaWithInput(args: readonly string[], input: Buffer) {
    const trusted = this.registry.verify(basename(this.config.limactlPath));
    return this.run(trusted.spawnPath, args, undefined, undefined, this.hostEnv(), input);
  }

  private async instance(): Promise<ValidatedLimaInstance> {
    const version = await this.lima(['--version']);
    if (version.code !== 0 || !supportedVersion(version.stdout)) {
      throw new Error(`unsupported Lima version: ${redactText(version.stdout || version.stderr)}`);
    }
    const listed = await this.lima(['list', '--json']);
    if (listed.code !== 0)
      throw new Error(`cannot inspect Lima instance: ${redactText(listed.stderr)}`);
    const rows = listed.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    const row = rows.find(
      (value) =>
        typeof value === 'object' &&
        value !== null &&
        Reflect.get(value, 'name') === this.config.instance,
    );
    if (!row) throw new Error(`required Lima instance is absent: ${this.config.instance}`);
    return validateResolvedLimaInstance(row, this.config.instance);
  }

  async inspect(): Promise<BackendStatus> {
    try {
      const instance = await this.instance();
      return {
        kind: this.kind,
        available: existsSync(this.config.limactlPath),
        filesystemIsolation: true,
        networkIsolation: true,
        lifecycleIsolation: true,
        detail: `validated isolated Lima instance ${instance.name} (${instance.status})`,
      };
    } catch (error) {
      return {
        kind: this.kind,
        available: false,
        filesystemIsolation: false,
        networkIsolation: false,
        lifecycleIsolation: false,
        detail: redactText(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async probeProvider(executable: string): Promise<BackendProviderStatus> {
    if (!isCapabilityAvailable('live-agent-execution')) {
      return {
        executable,
        installed: false,
        authenticated: false,
        detail: 'provider probing is disabled while live-agent-execution is unavailable',
      };
    }
    const profile = guestProviderProfile(executable);
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    try {
      await this.start();
      await this.materializeCredentialIntoStaticHome(profile);
      const result = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '-n',
        '-u',
        profile.user,
        'env',
        '-i',
        `HOME=${profile.home}`,
        `USER=${profile.user}`,
        `LOGNAME=${profile.user}`,
        `PATH=${dirname(profile.executable)}:/usr/bin:/bin`,
        profile.executable,
        ...profile.probeArgs,
      ]);
      const output = `${result.stdout}\n${result.stderr}`;
      const installed = result.code !== 127 && !/not found/i.test(output);
      const authenticated = result.code === 0 && profile.authenticated.test(output);
      let version: string | undefined;
      if (installed) {
        const versionResult = await this.lima([
          'shell',
          '--tty=false',
          this.config.instance,
          'sudo',
          '-n',
          '-u',
          profile.user,
          'env',
          '-i',
          `HOME=${profile.home}`,
          `USER=${profile.user}`,
          `LOGNAME=${profile.user}`,
          `PATH=${dirname(profile.executable)}:/usr/bin:/bin`,
          profile.executable,
          '--version',
        ]);
        version = `${versionResult.stdout}\n${versionResult.stderr}`.match(/\d+\.\d+\.\d+/)?.[0];
      }
      return {
        executable: profile.executable,
        installed,
        authenticated,
        detail: !installed
          ? 'provider executable is unavailable in the isolated worker'
          : authenticated
            ? 'provider is installed and authenticated in the isolated worker'
            : 'provider is installed but authentication was not confirmed in the isolated worker',
        ...(version !== undefined ? { version } : {}),
      };
    } finally {
      try {
        await this.stop();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  /**
   * Live Codex usage for already-imported accounts. Reuses the canonical
   * provider-auth slots and the isolated Codex CLI; does not probe routing
   * state, rewrite credentials, or touch the guest user's static home.
   */
  async readCodexUsage(accountLabels: readonly string[]): Promise<CodexUsageAccount[]> {
    if (!isCapabilityAvailable('live-agent-execution')) {
      return accountLabels.map((accountLabel) => ({
        accountLabel,
        error: 'Codex usage is disabled while live-agent-execution is unavailable',
      }));
    }
    const profile = guestProviderProfile('codex');
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    const accounts: CodexUsageAccount[] = [];
    try {
      await this.start();
      for (const accountLabel of accountLabels) {
        const scratchHome = usageScratchHome(randomUUID());
        try {
          accounts.push(await this.readOneCodexAccount(profile, accountLabel, scratchHome));
        } catch (error) {
          accounts.push({
            accountLabel,
            error: redactCodexUsageText(redactText(errorText(error))),
          });
        } finally {
          await this.lima([
            'shell',
            '--tty=false',
            this.config.instance,
            'sudo',
            'rm',
            '-rf',
            '--',
            scratchHome,
          ]).catch(() => undefined);
        }
      }
      return accounts;
    } finally {
      try {
        await this.stop();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  private async readOneCodexAccount(
    profile: GuestProviderProfile,
    accountLabel: string,
    scratchHome: string,
  ): Promise<CodexUsageAccount> {
    const canonicalPath = canonicalCodexAuthPath(accountLabel);
    const present = await this.lima([
      'shell',
      '--tty=false',
      this.config.instance,
      'sudo',
      'test',
      '-f',
      canonicalPath,
    ]);
    if (present.code !== 0) {
      return {
        accountLabel,
        error: `no Codex credential in the provider-auth store for ${accountLabel}`,
      };
    }
    const targetPath = `${scratchHome}/${profile.authRelativePath}`;
    const targetDir = dirname(targetPath);
    const staged = await this.lima([
      'shell',
      '--tty=false',
      this.config.instance,
      'sudo',
      'sh',
      '-c',
      `install -d -o '${profile.user}' -g '${profile.user}' -m 0700 ` +
        `'${scratchHome}' '${scratchHome}/tmp' '${targetDir}' && ` +
        `cp -- '${canonicalPath}' '${targetPath}' && ` +
        `chown '${profile.user}:${profile.user}' '${targetPath}' && chmod 600 '${targetPath}'`,
    ]);
    if (staged.code !== 0) {
      return {
        accountLabel,
        error: redactCodexUsageText(
          `could not stage Codex credentials for ${accountLabel}: ${redactText(
            staged.stderr || staged.stdout,
          )}`,
        ),
      };
    }
    const snapshot = await this.runCodexAppServerSession(profile, scratchHome);
    return { accountLabel, ...snapshot };
  }

  private async runCodexAppServerSession(
    profile: GuestProviderProfile,
    scratchHome: string,
  ): Promise<CodexAppServerSnapshot> {
    const trusted = this.registry.verify(basename(this.config.limactlPath));
    const child = spawn(
      trusted.spawnPath,
      [
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '-n',
        '-u',
        profile.user,
        'env',
        '-i',
        `HOME=${scratchHome}`,
        `USER=${profile.user}`,
        `LOGNAME=${profile.user}`,
        `TMPDIR=${scratchHome}/tmp`,
        `PATH=${dirname(profile.executable)}:/usr/bin:/bin`,
        profile.executable,
        'app-server',
      ],
      { env: this.hostEnv(), stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: true },
    );
    this.activeChild = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (typeof child.pid === 'number') process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        // The app-server may already have exited.
      }
    };
    try {
      if (!child.stdin || !child.stdout) {
        throw new Error('Codex app-server transport is unavailable');
      }
      return await queryCodexAppServer(child.stdin, child.stdout, {
        startupDelayMs: CODEX_APP_SERVER_STARTUP_DELAY_MS,
        readyDelayMs: CODEX_APP_SERVER_READY_DELAY_MS,
      });
    } catch (error) {
      const detail = redactText(stderr).trim();
      throw new Error(detail ? `${errorText(error)} (${detail})` : errorText(error));
    } finally {
      try {
        child.stdin?.end();
      } catch {
        // Ignore a transport that already closed.
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal('SIGKILL');
          finish();
        }, 1000);
        child.once('close', finish);
        signal('SIGTERM');
      });
      if (this.activeChild === child) this.activeChild = undefined;
    }
  }

  /**
   * Found by real end-to-end testing, not by design review: the canonical
   * provider-auth store (written by both host-credential import and
   * provider-native login) is never otherwise read from anywhere — a
   * credential could be imported/logged in successfully and the provider
   * would still probe as not-authenticated forever, because probeProvider
   * checks the dedicated guest user's STATIC home
   * (`/home/major-<provider>`), which nothing had ever synced from the
   * store. This makes the canonical store the actual source of truth for
   * that static home too, refreshed before every probe — a no-op when
   * nothing has been connected yet (checked first; the static home is left
   * exactly as-is), and correctly picking up a changed credential after a
   * manual account swap.
   */
  private async materializeCredentialIntoStaticHome(profile: GuestProviderProfile): Promise<void> {
    const canonicalPath = `/var/lib/major/provider-auth/${profile.host}/${profile.authRelativePath}`;
    const targetPath = `${profile.home}/${profile.authRelativePath}`;
    const targetDir = dirname(targetPath);
    const script =
      `if [ -f '${canonicalPath}' ]; then ` +
      `install -d -o '${profile.user}' -g '${profile.user}' -m 0700 '${targetDir}' && ` +
      `cp -- '${canonicalPath}' '${targetPath}' && ` +
      `chown '${profile.user}:${profile.user}' '${targetPath}' && ` +
      `chmod 600 '${targetPath}'; ` +
      `fi`;
    await this.lima(['shell', '--tty=false', this.config.instance, 'sudo', 'sh', '-c', script]);
  }

  /**
   * Moves the user's OWN host provider credential into their OWN local
   * worker's canonical provider-auth store — the self-service onboarding
   * operation (`major provider connect`). Requires no Workshop/staged
   * authority: the caller already has read access to the host file and
   * control of this local worker. Scope is fixed and narrow (one exact
   * provider, one exact host path, this worker) — never arbitrary transfer.
   * All process spawning stays inside this already-audited module; the
   * actual host-side symlink/hardlink/mode checks happen twice — once here
   * as defense in depth, and once already in the caller
   * (src/providers/host-credential.ts) before this is ever invoked.
   */
  async importProviderCredential(
    host: 'claude' | 'codex' | 'cursor' | 'antigravity',
    hostCredentialPath: string,
  ): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    if (!isCapabilityAvailable('live-agent-execution')) {
      return {
        ok: false,
        detail: 'credential import is disabled while live-agent-execution is unavailable',
      };
    }
    // This invariant otherwise holds only because the single current caller
    // (lifecycle-cli.ts's `connect`) derives both `host` and this path from
    // the same map — re-verify it structurally so a future caller can't
    // import provider A's credential under provider B's identity by mistake.
    if (hostCredentialPath !== expectedHostCredentialPath(host)) {
      return {
        ok: false,
        detail: `refusing to import: the given path does not match ${host}'s known host credential location`,
      };
    }
    const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
    const importScript = join(executingRoot, 'scripts', 'import-major-provider-credential.py');
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    try {
      await this.start();
      const guestTmp = '/tmp/major-credential-import';
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        guestTmp,
      ]);
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'install',
        '-d',
        '-m',
        '0700',
        guestTmp,
      ]);
      const copiedCredential = await this.lima([
        'copy',
        hostCredentialPath,
        `${this.config.instance}:${guestTmp}/staged`,
      ]);
      if (copiedCredential.code !== 0) {
        return {
          ok: false,
          detail:
            'could not send this credential to the isolated worker — try again; ' +
            `technical detail: ${redactText(copiedCredential.stderr)}`,
        };
      }
      return await this.placeStagedCredentialIntoStore(host, guestTmp, importScript);
    } finally {
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        '/tmp/major-credential-import',
      ]).catch(() => undefined);
      try {
        await this.stop();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  /**
   * Shared tail of both host-import and native-login onboarding: the
   * credential is already staged at `${guestTmp}/staged` inside the guest
   * (from a host copy, or from a just-completed native login) — stage the
   * already-audited broker script alongside it and invoke it to normalize
   * the credential into the canonical, root-owned provider-auth store.
   * Never a second credential architecture, just the one broker used from
   * two different sources.
   */
  private async placeStagedCredentialIntoStore(
    host: 'claude' | 'codex' | 'cursor' | 'antigravity',
    guestTmp: string,
    importScript: string,
    accountLabel: string = DEFAULT_ACCOUNT_LABEL,
  ): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    assertAccountLabel(accountLabel);
    const copiedScript = await this.lima([
      'copy',
      importScript,
      `${this.config.instance}:${guestTmp}/import.py`,
    ]);
    if (copiedScript.code !== 0) {
      return {
        ok: false,
        detail:
          'could not prepare the isolated worker to receive this credential — try again; ' +
          `technical detail: ${redactText(copiedScript.stderr)}`,
      };
    }
    const placed = await this.lima([
      'shell',
      '--tty=false',
      this.config.instance,
      'sudo',
      'python3',
      `${guestTmp}/import.py`,
      host,
      ...(accountLabel === DEFAULT_ACCOUNT_LABEL ? [] : [accountLabel]),
    ]);
    if (placed.code !== 0) {
      return {
        ok: false,
        detail: `credential import broker refused: ${redactText(placed.stderr || placed.stdout)}`,
      };
    }
    return { ok: true, detail: placed.stdout.trim() };
  }

  /**
   * Import one approved Codex profile credential into a named provider-auth
   * slot. Copies from the profile's existing auth.json through the same guest
   * staging broker as host onboarding; never modifies the source file or the
   * default credential slot.
   */
  async importCodexProfileCredential(
    profileHome: string,
    accountLabel: string,
  ): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    if (!isCapabilityAvailable('live-agent-execution')) {
      return {
        ok: false,
        detail: 'credential import is disabled while live-agent-execution is unavailable',
      };
    }
    try {
      assertAccountLabel(accountLabel);
    } catch (error) {
      return { ok: false, detail: errorText(error) };
    }
    if (accountLabel === DEFAULT_ACCOUNT_LABEL) {
      return {
        ok: false,
        detail: 'refusing to import an approved profile into the default Codex credential slot',
      };
    }
    let resolved: string;
    try {
      const canonicalHome = realpathSync(resolve(profileHome));
      resolved = join(canonicalHome, 'auth.json');
    } catch {
      return { ok: false, detail: 'approved Codex profile home is unavailable or unsafe' };
    }
    let sourceFd: number | undefined;
    let credential: Buffer;
    try {
      sourceFd = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
      const source = fstatSync(sourceFd);
      if (!source.isFile() || source.nlink !== 1) {
        return { ok: false, detail: 'approved Codex profile credential is not a regular file' };
      }
      credential = readFileSync(sourceFd);
    } catch {
      return { ok: false, detail: 'approved Codex profile credential is unavailable or unsafe' };
    } finally {
      if (sourceFd !== undefined) closeSync(sourceFd);
    }
    try {
      const parsed: unknown = JSON.parse(credential.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length === 0) {
        return { ok: false, detail: 'approved Codex profile credential is not valid JSON' };
      }
    } catch {
      return { ok: false, detail: 'approved Codex profile credential is not valid JSON' };
    }

    const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
    const importScript = join(executingRoot, 'scripts', 'import-major-provider-credential.py');
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    try {
      await this.start();
      const guestTmp = '/tmp/major-credential-import';
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        guestTmp,
      ]);
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'install',
        '-d',
        '-m',
        '0700',
        guestTmp,
      ]);
      const copiedCredential = await this.limaWithInput(
        [
          'shell',
          '--tty=false',
          this.config.instance,
          'sh',
          '-c',
          'umask 077; cat > "$1"',
          'major-credential-stage',
          `${guestTmp}/staged`,
        ],
        credential,
      );
      if (copiedCredential.code !== 0) {
        return {
          ok: false,
          detail:
            'could not send this credential to the isolated worker — try again; ' +
            `technical detail: ${redactText(copiedCredential.stderr)}`,
        };
      }
      const placed = await this.placeStagedCredentialIntoStore(
        'codex',
        guestTmp,
        importScript,
        accountLabel,
      );
      return placed;
    } finally {
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        '/tmp/major-credential-import',
      ]).catch(() => undefined);
      try {
        await this.stop();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  /**
   * Provider-native login inside the isolated worker: runs the provider's
   * OWN login flow (e.g. Codex's device-code auth) as the dedicated guest
   * user, in a fresh scratch home never touching that user's shared static
   * home -- so a cancelled/interrupted/failed attempt can never disturb an
   * existing working credential. Every printed line is relayed to `onLine`
   * as it arrives (already verified to contain only a URL/code/instruction,
   * never a secret). On success, the resulting credential is normalized into
   * the canonical store via the same broker host-import uses.
   */
  async loginProviderNative(
    host: 'claude' | 'codex' | 'cursor' | 'antigravity',
    onLine: (line: string) => void,
  ): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
    if (!isCapabilityAvailable('live-agent-execution')) {
      return {
        ok: false,
        detail: 'provider login is disabled while live-agent-execution is unavailable',
      };
    }
    const profile = guestProviderProfile(providerExecutable(host));
    if (!profile.loginArgs) {
      return {
        ok: false,
        detail: `native login inside the isolated worker is not yet supported for ${host}`,
      };
    }
    const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
    const importScript = join(executingRoot, 'scripts', 'import-major-provider-credential.py');
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    const scratchHome = `/tmp/major-native-login-${randomUUID()}`;
    try {
      await this.start();
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'install',
        '-d',
        '-o',
        profile.user,
        '-g',
        profile.user,
        '-m',
        '0700',
        scratchHome,
      ]);
      const loginResult = await this.lima(
        [
          'shell',
          '--tty=false',
          this.config.instance,
          'sudo',
          '-n',
          '-u',
          profile.user,
          'env',
          '-i',
          `HOME=${scratchHome}`,
          `USER=${profile.user}`,
          `LOGNAME=${profile.user}`,
          `PATH=${dirname(profile.executable)}:/usr/bin:/bin`,
          profile.executable,
          ...profile.loginArgs,
        ],
        onLine,
      );
      const authPath = `${scratchHome}/${profile.authRelativePath}`;
      const producedCredential = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'test',
        '-f',
        authPath,
      ]);
      if (producedCredential.code !== 0) {
        return {
          ok: false,
          detail:
            loginResult.code === 0
              ? 'the login process finished without producing a credential — it may have been cancelled or the code may have expired'
              : `the login process did not complete successfully (exit ${loginResult.code ?? 'unknown'})`,
        };
      }
      const guestTmp = '/tmp/major-credential-import';
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        guestTmp,
      ]);
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'install',
        '-d',
        '-m',
        '0700',
        guestTmp,
      ]);
      const staged = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'cp',
        '--',
        authPath,
        `${guestTmp}/staged`,
      ]);
      if (staged.code !== 0) {
        return {
          ok: false,
          detail: `could not stage the new credential for import: ${redactText(staged.stderr)}`,
        };
      }
      return await this.placeStagedCredentialIntoStore(host, guestTmp, importScript);
    } finally {
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        scratchHome,
      ]).catch(() => undefined);
      await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        '/tmp/major-credential-import',
      ]).catch(() => undefined);
      try {
        await this.stop();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  private async stop(force = false): Promise<void> {
    const before = await this.instance();
    if (before.status === 'Stopped') return;
    const result = await this.lima(['stop', ...(force ? ['--force'] : []), this.config.instance]);
    if (result.code !== 0 && !/already stopped|not running/i.test(result.stderr)) {
      throw new Error(`failed to stop Lima instance: ${redactText(result.stderr)}`);
    }
    const instance = await this.instance();
    if (instance.status !== 'Stopped') {
      throw new Error(`Lima instance did not stop cleanly: ${instance.status}`);
    }
  }

  private async start(): Promise<ValidatedLimaInstance> {
    const result = await this.lima(['start', this.config.instance]);
    if (result.code !== 0)
      throw new Error(`failed to start Lima instance: ${redactText(result.stderr)}`);
    const instance = await this.instance();
    if (instance.status !== 'Running') {
      throw new Error(`Lima instance did not reach Running state: ${instance.status}`);
    }
    return instance;
  }

  private async acquireLock(lock: string): Promise<void> {
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }
      const ownerPath = join(lock, 'owner.json');
      let owner = 0;
      try {
        owner = Number((JSON.parse(readFileSync(ownerPath, 'utf8')) as { pid?: number }).pid ?? 0);
      } catch {
        owner = 0;
      }
      let alive = false;
      try {
        if (owner > 0) process.kill(owner, 0);
        alive = owner > 0;
      } catch {
        alive = false;
      }
      if (alive) throw new Error(`Lima backend is already owned by process ${owner}`);
      await this.stop(true);
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock, { mode: 0o700 });
    }
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  }

  private async removeGuestRun(guestRun: string): Promise<void> {
    if (
      !/^\/var\/lib\/major\/runs\/(claude|codex|cursor|antigravity)\/[a-f0-9-]{36}$/.test(guestRun)
    ) {
      throw new Error('refusing unsafe guest cleanup path');
    }
    await this.start();
    const removed = await this.lima([
      'shell',
      '--tty=false',
      this.config.instance,
      'sudo',
      'rm',
      '-rf',
      '--',
      guestRun,
    ]);
    if (removed.code !== 0) {
      throw new Error(`guest cleanup failed: ${redactText(removed.stderr)}`);
    }
  }

  private async removeGuestTransfer(runId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('refusing unsafe guest transfer cleanup');
    const removed = await this.lima([
      'shell',
      '--tty=false',
      this.config.instance,
      'rm',
      '-rf',
      '--',
      `/var/lib/major/transfer/${runId}`,
    ]);
    if (removed.code !== 0) {
      throw new Error(`guest transfer cleanup failed: ${redactText(removed.stderr)}`);
    }
  }

  private async reconcileStaleRuns(stateRoot: string): Promise<void> {
    for (const stale of pendingRunManifests(stateRoot)) {
      await this.removeGuestRun(stale.guestRun);
      await this.removeGuestTransfer(stale.runId);
      writeRunManifest(stateRoot, {
        ...stale,
        state: 'terminal',
        cleanup: 'complete',
        result: stale.result ?? 'failed',
        terminalAt: stale.terminalAt ?? new Date().toISOString(),
      });
    }
  }

  execute(request: BackendExecuteRequest): ExecuteHandle {
    let stagedCaseId: string | undefined;
    if (request.executionAuthority.kind === 'supervised') {
      if (!isCapabilityAvailable('live-agent-execution')) {
        throw new Error('supervised provider execution is unavailable while M1 is disabled');
      }
    } else if (request.executionAuthority.kind === 'supervised_workshop') {
      if (globalStopRequested()) throw new Error('Major global kill switch is active');
      assertSupervisedWorkshopAuthority(request.executionAuthority, request.cwd);
      if (!request.resourceLeaseId) {
        throw new Error('supervised Workshop backend requires a worker resource lease');
      }
      assertActiveResourceLeaseForProcess({
        leaseId: request.resourceLeaseId,
        kind: 'worker',
        pid: process.pid,
      });
    } else {
      if (globalStopRequested()) throw new Error('Major global kill switch is active');
      if (!request.providerRequest) {
        throw new Error('staged validation requires a structured provider request');
      }
      const opened = openDb();
      try {
        const candidate = getStagedValidationLease(opened.db, request.executionAuthority.leaseId);
        stagedCaseId = candidate.caseId;
        const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
        const release = JSON.parse(readFileSync(join(executingRoot, 'release.json'), 'utf8')) as {
          repository?: string;
          branch?: string;
          sha?: string;
          treeHash?: string;
          sourceCheckout?: string;
        };
        execFileSync(
          process.execPath,
          [join(executingRoot, 'scripts', 'major-runtime-manifest.mjs'), 'verify', executingRoot],
          { cwd: executingRoot, encoding: 'utf8', env: {} },
        );
        const manifestHash = createHash('sha256')
          .update(readFileSync(join(executingRoot, 'runtime-manifest.json')))
          .digest('hex');
        const sourceSha = execFileSync(
          '/usr/bin/git',
          ['-C', candidate.releaseSourceCheckout, 'rev-parse', 'HEAD'],
          { encoding: 'utf8', env: {} },
        ).trim();
        const sourceBranch = execFileSync(
          '/usr/bin/git',
          ['-C', candidate.releaseSourceCheckout, 'rev-parse', '--abbrev-ref', 'HEAD'],
          { encoding: 'utf8', env: {} },
        ).trim();
        const sourceTree = execFileSync(
          '/usr/bin/git',
          ['-C', candidate.releaseSourceCheckout, 'rev-parse', 'HEAD^{tree}'],
          { encoding: 'utf8', env: {} },
        ).trim();
        const sourceStatus = execFileSync(
          '/usr/bin/git',
          ['-C', candidate.releaseSourceCheckout, 'status', '--porcelain', '--untracked-files=all'],
          { encoding: 'utf8', env: {} },
        ).trim();
        if (
          executingRoot !== realpathSync(candidate.releaseRoot) ||
          release.repository !== candidate.releaseRepository ||
          release.branch !== candidate.releaseBranch ||
          release.sha !== candidate.releaseSha ||
          release.treeHash !== candidate.releaseTreeHash ||
          realpathSync(release.sourceCheckout ?? '') !== candidate.releaseSourceCheckout ||
          manifestHash !== candidate.releaseManifestHash ||
          sourceSha !== candidate.releaseSha ||
          sourceBranch !== candidate.releaseBranch ||
          createHash('sha256').update(sourceTree).digest('hex') !== candidate.releaseTreeHash ||
          sourceStatus !== '' ||
          this.config.instance !== `major-worker-${candidate.releaseSha.slice(0, 12)}` ||
          this.config.limactlPath !== '/opt/homebrew/bin/limactl' ||
          this.config.guestRunRoot !== '/var/lib/major/runs' ||
          this.config.isolationScope !== 'shared-workshop'
        ) {
          throw new Error('staged validation backend release binding is invalid');
        }
        execFileSync(
          '/bin/bash',
          [
            join(candidate.releaseSourceCheckout, 'scripts', 'verify-major-staged-candidate.sh'),
            executingRoot,
          ],
          {
            encoding: 'utf8',
            env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
            timeout: 10 * 60 * 1000,
          },
        );
        const secureEnclaveAuthority = verifySecureEnclaveStagedValidationAuthority({
          releaseSha: candidate.releaseSha,
          caseId: candidate.caseId as Parameters<
            typeof verifySecureEnclaveStagedValidationAuthority
          >[0]['caseId'],
          provider: candidate.provider as BackendExecuteRequest['providerRequest'] extends {
            host: infer Host;
          }
            ? Host
            : never,
        });
        if (
          secureEnclaveAuthority.leaseId !== candidate.authorityLeaseId ||
          secureEnclaveAuthority.artifactDigest !== candidate.authorityArtifactDigest ||
          secureEnclaveAuthority.validationNonce !== candidate.authorityValidationNonce ||
          secureEnclaveAuthority.expiresAt !== candidate.authorityExpiresAt
        ) {
          throw new Error('staged validation backend authority does not match Secure Enclave');
        }
        assertStagedValidationCaseRequest(opened.db, candidate, {
          executable: request.executable,
          args: request.args,
          cwd: request.cwd,
          providerRequest: request.providerRequest,
        });
        const lease = consumeStagedValidationExecution(
          opened.db,
          request.executionAuthority,
          stagedValidationRequestDigest({
            executable: request.executable,
            args: request.args,
            cwd: request.cwd,
            providerRequest: request.providerRequest,
          }),
        );
        if (!lease.resourceLeaseId) {
          throw new Error('staged validation backend is missing its worker resource lease');
        }
        assertActiveResourceLease({
          leaseId: lease.resourceLeaseId,
          kind: 'worker',
          owner: lease.workerId,
          pid: process.pid,
        });
      } finally {
        opened.sqlite.close();
      }
    }
    if (request.providerRequest) {
      assertGuestMutationPolicy({
        host: request.providerRequest.host,
        allowGuestMutation: request.providerRequest.allowGuestMutation,
        ...(request.providerRequest.workspaceHash
          ? { workspaceHash: request.providerRequest.workspaceHash }
          : {}),
        executionAuthorityKind: request.executionAuthority.kind,
        isolatedBackend: true,
      });
    }
    const queue = new EventQueue<ProviderEvent>();
    const runId = randomUUID();
    this.cancelled = false;
    this.forceStopRequired = false;
    this.activeAbort = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        this.cancel();
      },
      request.timeoutMs ?? 30 * 60 * 1000,
    );
    timeout.unref();
    const authorityWatcher =
      request.executionAuthority.kind === 'staged_validation' ||
      request.executionAuthority.kind === 'supervised_workshop'
        ? setInterval(() => {
            if (globalStopRequested()) {
              this.cancel();
              return;
            }
            if (request.executionAuthority.kind === 'supervised_workshop') {
              try {
                assertSupervisedWorkshopAuthority(request.executionAuthority, request.cwd);
              } catch {
                this.cancel();
              }
            } else if (request.executionAuthority.kind === 'staged_validation') {
              const opened = openDb();
              try {
                const lease = getStagedValidationLease(
                  opened.db,
                  request.executionAuthority.leaseId,
                );
                if (!['running', 'validating'].includes(lease.status)) this.cancel();
              } catch {
                this.cancel();
              } finally {
                opened.sqlite.close();
              }
            }
          }, 1_000)
        : undefined;
    authorityWatcher?.unref();
    const outcome = this.executeRun(
      request,
      queue,
      runId,
      () => (timedOut ? 'timed_out' : this.cancelled ? 'cancelled' : 'failed'),
      stagedCaseId,
    )
      .catch((error): ExecuteOutcome => {
        return {
          status: timedOut ? 'timed_out' : this.cancelled ? 'cancelled' : 'failed',
          runId,
          errorKind: timedOut ? 'timed_out' : this.cancelled ? 'cancelled' : errorKind(error),
          cleanup: /cleanup failed/i.test(errorText(error)) ? 'failed' : 'complete',
          exitCode: null,
          rateLimited: false,
          exhausted: false,
          stderrTail: redactText(error instanceof Error ? error.message : String(error)).slice(
            -2000,
          ),
        };
      })
      .finally(() => {
        clearTimeout(timeout);
        if (authorityWatcher) clearInterval(authorityWatcher);
        this.activeAbort = undefined;
        queue.close();
      });
    return { events: queue, cancel: () => this.cancel(), outcome };
  }

  private cancel(): void {
    this.cancelled = true;
    this.forceStopRequired = true;
    this.activeAbort?.abort(new Error('Major provider execution cancelled'));
    const pid = this.activeChild?.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // Host controller has already exited.
      }
    }
  }

  private async executeRun(
    request: BackendExecuteRequest,
    queue: EventQueue<ProviderEvent>,
    runId: string,
    failureStatus: () => 'failed' | 'timed_out' | 'cancelled',
    stagedCaseId?: string,
  ) {
    const profile = guestProviderProfile(request.executable);
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const runRoot = join(stateRoot, 'runs', runId);
    const inputWorkspace = join(runRoot, 'input', 'workspace');
    const resultRoot = join(runRoot, 'result');
    const liveWorkspace = join(runRoot, 'live', 'workspace');
    const patchPath = join(runRoot, 'workspace.patch');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    const guestRun = safeGuestRunPath(this.config.guestRunRoot, profile.host, runId);
    const guestHome = guestProjectHome(guestRun);
    const guestWorkspace = `${guestRun}/workspace`;
    const guestTransfer = `/var/lib/major/transfer/${runId}`;
    let manifest: LimaRunManifest = {
      runId,
      provider: profile.host,
      projectHash: createHash('sha256').update(realpathSync(request.cwd)).digest('hex'),
      guestRun,
      state: 'preparing',
      cleanup: 'pending',
      startedAt: new Date().toISOString(),
      ...(request.resourceLeaseId ? { resourceLeaseId: request.resourceLeaseId } : {}),
    };
    let manifestWritten = false;
    let guestPrepared = false;
    let transferPrepared = false;
    let runSucceeded = false;
    try {
      reconcileResources({
        ...productionCleanupDeps(
          majorHome(),
          createReclaimTools({ limactlPath: this.config.limactlPath }),
        ),
        phase: 'before-create',
        apply: true,
      });
      await this.reconcileStaleRuns(stateRoot);
      mkdirSync(runRoot, { recursive: true, mode: 0o700 });
      writeRunManifest(stateRoot, manifest);
      manifestWritten = true;
      snapshotWorkspace(request.cwd, inputWorkspace);
      const baselineHash = hashWorkspaceTree(inputWorkspace);
      if (request.providerRequest?.host === 'codex' && request.providerRequest.allowGuestMutation) {
        if (!request.providerRequest.workspaceHash) {
          throw new Error('mutable provider execution requires a source workspace digest');
        }
        if (request.providerRequest.workspaceHash !== baselineHash) {
          throw new Error('source workspace changed before isolated execution began');
        }
      }
      const instance = await this.start();
      if (request.executionAuthority.kind === 'staged_validation') {
        const marker = await this.lima([
          'shell',
          '--tty=false',
          this.config.instance,
          'test',
          '-r',
          `/opt/major/releases/${request.executionAuthority.releaseSha}`,
        ]);
        if (marker.code !== 0) {
          throw new Error('staged validation guest release marker is absent');
        }
      }
      const prepared = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'install',
        '-d',
        '-m',
        '0710',
        '-o',
        'root',
        '-g',
        profile.user,
        guestRun,
      ]);
      if (prepared.code !== 0)
        throw new Error(`guest preparation failed: ${redactText(prepared.stderr)}`);
      guestPrepared = true;
      const preparedState = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '/opt/major/manage-provider-state',
        'prepare',
        profile.host,
        manifest.projectHash,
        guestHome,
        ...providerStateAccountArgs(request.providerRequest?.accountLabel),
      ]);
      if (preparedState.code !== 0) {
        throw new Error(`provider state preparation failed: ${redactText(preparedState.stderr)}`);
      }
      const preparedTransfer = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'install',
        '-d',
        '-m',
        '0700',
        guestTransfer,
      ]);
      if (preparedTransfer.code !== 0) {
        throw new Error(
          `guest transfer preparation failed: ${redactText(preparedTransfer.stderr)}`,
        );
      }
      transferPrepared = true;
      const copied = await this.lima([
        'copy',
        '--backend=scp',
        '--recursive',
        inputWorkspace,
        `${this.config.instance}:${guestTransfer}/`,
      ]);
      if (copied.code !== 0)
        throw new Error(`workspace copy-in failed: ${redactText(copied.stderr)}`);
      const installedWorkspace = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'mv',
        '--',
        `${guestTransfer}/workspace`,
        guestWorkspace,
      ]);
      if (installedWorkspace.code !== 0) {
        throw new Error(`workspace installation failed: ${redactText(installedWorkspace.stderr)}`);
      }
      const owned = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'chown',
        '-R',
        `${profile.user}:${profile.user}`,
        guestWorkspace,
      ]);
      if (owned.code !== 0) throw new Error(`guest ownership failed: ${redactText(owned.stderr)}`);
      const initialized = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '-n',
        '-u',
        profile.user,
        '/usr/bin/git',
        '-C',
        guestWorkspace,
        'init',
        '--initial-branch=major-run',
      ]);
      if (initialized.code !== 0) {
        throw new Error(
          `guest repository initialization failed: ${redactText(initialized.stderr)}`,
        );
      }
      manifest = { ...manifest, state: 'running' };
      writeRunManifest(stateRoot, manifest);
      if (profile.host === 'antigravity') {
        const configured = await this.lima([
          'shell',
          '--tty=false',
          this.config.instance,
          'sudo',
          '-n',
          '-u',
          profile.user,
          'env',
          `HOME=${guestHome}`,
          '/opt/major/configure-antigravity-run',
          guestWorkspace,
        ]);
        if (configured.code !== 0) {
          throw new Error(`Antigravity run configuration failed: ${redactText(configured.stderr)}`);
        }
      }
      let provider: CommandResult &
        Partial<
          Pick<
            AgentRuntimeResult,
            'sessionRef' | 'usage' | 'modelSelection' | 'requestedModel' | 'actualModel'
          >
        >;
      const providerIntent = request.providerRequest;
      if (!providerIntent || providerIntent.host !== profile.host) {
        throw new Error(`${profile.host} requires a structured Major provider request`);
      }
      validateVerifiedProviderApprovalAuthority(profile.host, providerIntent.approvalAuthority);
      if (profile.host === 'cursor') {
        const intent = providerIntent;
        const abortSignal = this.activeAbort?.signal;
        if (!abortSignal) throw new Error('provider cancellation boundary is unavailable');
        this.forceStopRequired = true;
        const runtime = new CursorAcpRuntime(this.config, (child) => {
          this.activeChild = child;
        });
        const result = await runtime.execute({
          host: intent.host,
          prompt: intent.prompt,
          allowGuestMutation: intent.allowGuestMutation,
          approvalAuthority: intent.approvalAuthority,
          ...(intent.workshopMode ? { workshopMode: true } : {}),
          ...(intent.modelRef ? { modelRef: intent.modelRef } : {}),
          ...(intent.resumeSessionRef ? { resumeSessionRef: intent.resumeSessionRef } : {}),
          guestRun,
          guestHome,
          guestWorkspace,
          runId,
          abortSignal,
          emit: (event) => queue.push(event),
        });
        provider = {
          code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.sessionRef ? { sessionRef: result.sessionRef } : {}),
          ...(result.usage !== undefined ? { usage: result.usage } : {}),
          modelSelection: result.modelSelection,
          ...(result.requestedModel ? { requestedModel: result.requestedModel } : {}),
          ...(result.actualModel ? { actualModel: result.actualModel } : {}),
        };
        this.forceStopRequired = false;
      } else {
        let sessionRef: string | undefined;
        let usage: unknown;
        provider = await this.lima(
          [
            'shell',
            '--tty=false',
            this.config.instance,
            'sudo',
            '-n',
            '-u',
            profile.user,
            'env',
            '-i',
            `HOME=${guestHome}`,
            `USER=${profile.user}`,
            `LOGNAME=${profile.user}`,
            `PATH=${dirname(profile.executable)}:/usr/local/bin:/usr/bin:/bin`,
            `TMPDIR=${guestHome}/tmp`,
            `XDG_CACHE_HOME=${guestHome}/.cache`,
            `XDG_CONFIG_HOME=${guestHome}/.config`,
            `XDG_DATA_HOME=${guestHome}/.local/share`,
            '/opt/major/run-provider',
            guestWorkspace,
            profile.executable,
            ...request.args,
          ],
          (line) => {
            const event = request.parseLine?.(line) ?? { type: 'stdout', data: line };
            if (event) {
              const nextSessionRef = request.extractSessionRef?.(event);
              if (nextSessionRef) sessionRef = nextSessionRef;
              const nextUsage = request.extractUsage?.(event);
              if (nextUsage !== undefined) usage = nextUsage;
              queue.push(event);
            }
          },
        );
        if (sessionRef) provider.sessionRef = sessionRef;
        if (usage !== undefined) provider.usage = usage;
        provider.modelSelection = 'supported';
        const requestedModel = request.providerRequest?.modelRef;
        if (requestedModel && requestedModel !== 'auto') provider.requestedModel = requestedModel;
      }
      if (this.cancelled) {
        await this.stop(true);
        throw new Error('Lima execution cancelled');
      }
      if (provider.code !== 0) {
        let workerInterrupted = false;
        try {
          workerInterrupted = (await this.instance()).status === 'Stopped';
        } catch {
          // An absent or uninspectable worker is not accepted as forced-stop evidence.
        }
        await this.stop(true);
        manifest = { ...manifest, result: 'failed' };
        return {
          status: 'failed' as const,
          runId,
          errorKind: workerInterrupted ? ('interrupted' as const) : ('provider_failed' as const),
          cleanup: 'complete' as const,
          exitCode: provider.code,
          ...detectProviderOutcomeSignals(provider, request),
          stderrTail: redactText(provider.stderr).slice(-2000),
          ...(provider.sessionRef ? { sessionRef: provider.sessionRef } : {}),
          ...(provider.usage !== undefined ? { usage: provider.usage } : {}),
          ...(provider.modelSelection ? { modelSelection: provider.modelSelection } : {}),
          ...(provider.requestedModel ? { requestedModel: provider.requestedModel } : {}),
          ...(provider.actualModel ? { actualModel: provider.actualModel } : {}),
        };
      }
      if (/no output produced|auto-denied|required the .* permission/i.test(provider.stderr)) {
        await this.stop(true);
        manifest = { ...manifest, result: 'failed' };
        return {
          status: 'failed' as const,
          runId,
          errorKind: 'protocol_invalid' as const,
          cleanup: 'complete' as const,
          exitCode: provider.code,
          rateLimited: false,
          exhausted: false,
          stderrTail: redactText(provider.stderr).slice(-2000),
          ...(provider.sessionRef ? { sessionRef: provider.sessionRef } : {}),
          ...(provider.usage !== undefined ? { usage: provider.usage } : {}),
          ...(provider.modelSelection ? { modelSelection: provider.modelSelection } : {}),
          ...(provider.requestedModel ? { requestedModel: provider.requestedModel } : {}),
          ...(provider.actualModel ? { actualModel: provider.actualModel } : {}),
        };
      }
      if (!provider.stdout.trim()) {
        await this.stop(true);
        manifest = { ...manifest, result: 'failed' };
        return {
          status: 'failed' as const,
          runId,
          errorKind: 'protocol_invalid' as const,
          cleanup: 'complete' as const,
          exitCode: provider.code,
          rateLimited: false,
          exhausted: false,
          stderrTail: 'provider exited successfully without a response',
        };
      }

      const finalizedState = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        '/opt/major/manage-provider-state',
        'finalize',
        profile.host,
        manifest.projectHash,
        guestHome,
        ...providerStateAccountArgs(request.providerRequest?.accountLabel),
      ]);
      if (finalizedState.code !== 0) {
        throw new Error(`provider state finalization failed: ${redactText(finalizedState.stderr)}`);
      }

      await this.stop();
      await this.start();
      manifest = { ...manifest, state: 'copying_back' };
      writeRunManifest(stateRoot, manifest);
      const removedGit = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'rm',
        '-rf',
        '--',
        `${guestWorkspace}/.git`,
      ]);
      if (removedGit.code !== 0)
        throw new Error(`guest Git cleanup failed: ${redactText(removedGit.stderr)}`);
      const stagedReturn = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'mv',
        '--',
        guestWorkspace,
        `${guestTransfer}/workspace`,
      ]);
      if (stagedReturn.code !== 0)
        throw new Error(`return staging failed: ${redactText(stagedReturn.stderr)}`);
      const returnedOwner = await this.lima([
        'shell',
        '--tty=false',
        this.config.instance,
        'sudo',
        'chown',
        '-R',
        `${instance.guestUser}:${instance.guestUser}`,
        guestTransfer,
      ]);
      if (returnedOwner.code !== 0)
        throw new Error(`return ownership failed: ${redactText(returnedOwner.stderr)}`);
      mkdirSync(resultRoot, { recursive: true, mode: 0o700 });
      const returned = await this.lima([
        'copy',
        '--backend=scp',
        '--recursive',
        `${this.config.instance}:${guestTransfer}/workspace`,
        resultRoot,
      ]);
      if (returned.code !== 0)
        throw new Error(`workspace copy-back failed: ${redactText(returned.stderr)}`);
      const resultWorkspace = join(resultRoot, 'workspace');
      validateWorkspaceTree(resultWorkspace);
      snapshotWorkspace(request.cwd, liveWorkspace);
      if (hashWorkspaceTree(liveWorkspace) !== baselineHash) {
        throw new Error('host workspace changed during execution; result remains quarantined');
      }

      manifest = { ...manifest, state: 'applying' };
      writeRunManifest(stateRoot, manifest);
      const diff = await this.runToFile(
        '/usr/bin/git',
        [
          'diff',
          '--no-index',
          '--binary',
          '--full-index',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          'input/workspace',
          'result/workspace',
        ],
        patchPath,
        runRoot,
      );
      const workspaceMutated = workspaceMutatedFromDiffExit(diff.code, diff.stderr);
      if (diff.code === 1 && !providerIntent.allowGuestMutation) {
        manifest = { ...manifest, result: 'failed' };
        return {
          status: 'failed' as const,
          runId,
          errorKind: 'protocol_invalid' as const,
          cleanup: 'complete' as const,
          exitCode: provider.code,
          rateLimited: false,
          exhausted: false,
          stderrTail: `${profile.host} attempted a workspace mutation outside its declared capability`,
          ...(provider.sessionRef ? { sessionRef: provider.sessionRef } : {}),
          ...(provider.usage !== undefined ? { usage: provider.usage } : {}),
          ...(provider.modelSelection ? { modelSelection: provider.modelSelection } : {}),
          ...(provider.requestedModel ? { requestedModel: provider.requestedModel } : {}),
          ...(provider.actualModel ? { actualModel: provider.actualModel } : {}),
        };
      }
      if (diff.code === 1) {
        assertGuestMutationPolicy({
          host: providerIntent.host,
          allowGuestMutation: true,
          ...(providerIntent.workspaceHash ? { workspaceHash: providerIntent.workspaceHash } : {}),
          executionAuthorityKind: request.executionAuthority.kind,
          isolatedBackend: true,
        });
        const check = await this.run('/usr/bin/git', [
          '-C',
          realpathSync(request.cwd),
          'apply',
          '--check',
          '-p3',
          patchPath,
        ]);
        if (check.code !== 0)
          throw new Error(`returned delta was rejected: ${redactText(check.stderr)}`);
        const applied = await this.run('/usr/bin/git', [
          '-C',
          realpathSync(request.cwd),
          'apply',
          '-p3',
          patchPath,
        ]);
        if (applied.code !== 0)
          throw new Error(`validated delta could not be applied: ${redactText(applied.stderr)}`);
      }
      if (stagedCaseId === 'jss-field') {
        if (diff.code !== 1) throw new Error('JSS field returned no project delta');
        const patch = readFileSync(patchPath, 'utf8');
        const paths = [
          ...patch.matchAll(/^diff --git a\/input\/workspace\/(.+) b\/result\/workspace\/(.+)$/gm),
        ].map((match) => match[2]!);
        if (
          paths.length === 0 ||
          !paths.some((path) => path.startsWith('src/')) ||
          !paths.some((path) => /(^|\/)(tests?\/|[^/]+\.test\.[^/]+$)/.test(path)) ||
          paths.some((path) =>
            /(^|\/)(\.env|package(?:-lock)?\.json)$|^migrations\/|^docs\//.test(path),
          )
        ) {
          throw new Error('JSS field did not return one bounded code-and-test delta');
        }
        await this.runContainedJssValidation(request.cwd, runRoot);
      }
      manifest = { ...manifest, result: 'succeeded' };
      runSucceeded = true;
      reconcileResources({
        ...productionCleanupDeps(
          majorHome(),
          createReclaimTools({ limactlPath: this.config.limactlPath }),
        ),
        phase: 'after-success',
        apply: true,
      });
      return {
        status: 'succeeded' as const,
        runId,
        cleanup: 'complete' as const,
        workspaceMutated,
        exitCode: 0,
        ...(provider.sessionRef ? { sessionRef: provider.sessionRef } : {}),
        ...(provider.usage !== undefined ? { usage: provider.usage } : {}),
        ...(provider.modelSelection ? { modelSelection: provider.modelSelection } : {}),
        ...(provider.requestedModel ? { requestedModel: provider.requestedModel } : {}),
        ...(provider.actualModel ? { actualModel: provider.actualModel } : {}),
        rateLimited: false,
        exhausted: false,
        stderrTail: redactText(provider.stderr).slice(-2000),
      };
    } finally {
      let cleanupError: unknown;
      try {
        if (!runSucceeded) {
          reconcileResources({
            ...productionCleanupDeps(
              majorHome(),
              createReclaimTools({ limactlPath: this.config.limactlPath }),
            ),
            phase: 'after-failure',
            apply: true,
          });
        }
        if (guestPrepared) await this.removeGuestRun(guestRun);
        if (transferPrepared) {
          await this.removeGuestTransfer(runId);
        }
        if (manifestWritten) {
          manifest = {
            ...manifest,
            state: 'terminal',
            cleanup: 'complete',
            result: manifest.result ?? failureStatus(),
            terminalAt: new Date().toISOString(),
          };
          writeRunManifest(stateRoot, manifest);
        }
      } catch (error) {
        cleanupError = error;
        if (manifestWritten) {
          manifest = {
            ...manifest,
            state: 'terminal',
            cleanup: 'failed',
            result: manifest.result ?? failureStatus(),
            terminalAt: new Date().toISOString(),
          };
          writeRunManifest(stateRoot, manifest);
        }
      }
      try {
        await this.stop(this.forceStopRequired || this.cancelled || cleanupError !== undefined);
      } catch (error) {
        cleanupError ??= error;
      }
      rmSync(lock, { recursive: true, force: true });
      if (cleanupError) {
        throw new Error(`cleanup failed: ${redactText(errorText(cleanupError))}`);
      }
    }
  }
}

/** git diff --no-index uses 0 for equal trees and 1 for a delta. Every other
 * exit is an inability to establish evidence and must fail closed. */
export function workspaceMutatedFromDiffExit(code: number | null, stderr = ''): boolean {
  if (code === 0) return false;
  if (code === 1) return true;
  throw new Error(`delta creation failed: ${redactText(stderr)}`);
}
