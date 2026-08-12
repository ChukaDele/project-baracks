import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { ExecuteHandle, ExecuteOutcome, ProviderEvent } from '../providers/types.js';
import { redactText } from '../security/redact.js';
import { TrustedExecutableRegistry } from '../security/trusted-executables.js';
import { validateProviderApprovalAuthority } from '../security/provider-approval-policy.js';
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
import { guestProjectHome, guestProviderProfile } from './provider-profile.js';
import { pendingRunManifests, writeRunManifest, type LimaRunManifest } from './run-manifest.js';
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
  ) {
    return new Promise<CommandResult>((resolvePromise, reject) => {
      let stdout = '';
      let stderr = '';
      let pending = '';
      const child = spawn(executable, [...args], {
        env: this.hostEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: true,
        ...(cwd ? { cwd } : {}),
      });
      this.activeChild = child;
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
      child.once('error', reject);
      child.once('close', (code) => {
        if (pending && onLine) onLine(pending);
        if (this.activeChild === child) this.activeChild = undefined;
        resolvePromise({ code, stdout, stderr });
      });
    });
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
    const profile = guestProviderProfile(executable);
    const stateRoot = join(majorHome(), 'execution', 'lima');
    const lock = join(stateRoot, 'backend.lock');
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    await this.acquireLock(lock);
    try {
      await this.start();
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
      return {
        executable: profile.executable,
        installed,
        authenticated,
        detail: !installed
          ? 'provider executable is unavailable in the isolated worker'
          : authenticated
            ? 'provider is installed and authenticated in the isolated worker'
            : 'provider is installed but authentication was not confirmed in the isolated worker',
      };
    } finally {
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
    const outcome = this.executeRun(request, queue, runId, () =>
      timedOut ? 'timed_out' : this.cancelled ? 'cancelled' : 'failed',
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
    try {
      await this.reconcileStaleRuns(stateRoot);
      mkdirSync(runRoot, { recursive: true, mode: 0o700 });
      writeRunManifest(stateRoot, manifest);
      manifestWritten = true;
      snapshotWorkspace(request.cwd, inputWorkspace);
      const baselineHash = hashWorkspaceTree(inputWorkspace);
      const instance = await this.start();
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
      validateProviderApprovalAuthority(profile.host, providerIntent.approvalAuthority);
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
        await this.stop(true);
        manifest = { ...manifest, result: 'failed' };
        return {
          status: 'failed' as const,
          runId,
          errorKind: 'provider_failed' as const,
          cleanup: 'complete' as const,
          exitCode: provider.code,
          rateLimited: request.detectRateLimit?.(provider.stderr) ?? false,
          exhausted: request.detectExhaustion?.(provider.stderr) ?? false,
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
      if (diff.code !== 0 && diff.code !== 1)
        throw new Error(`delta creation failed: ${redactText(diff.stderr)}`);
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
      manifest = { ...manifest, result: 'succeeded' };
      return {
        status: 'succeeded' as const,
        runId,
        cleanup: 'complete' as const,
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
