import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { withRoutedExecutionContext } from './route-context.js';

export const name = 'major-workstation';
export const inject = ['agents', 'commands', 'llm', 'subagents', 'subprocess'];

const OUTPUT_LIMIT = 256 * 1024;
const RESULT_LIMIT = 8 * 1024;
const NO_START_CAPABILITIES = Object.freeze({});
const SESSION_HOSTS = new Set(['claude', 'codex', 'cursor', 'antigravity']);
const FOREGROUND_DISPATCH_PREFIX = 'MAJOR_FOREGROUND_DISPATCH:';
const REVIEW_HASH_EXCLUSIONS = new Set(['node_modules']);
const GIT_CONTROL_NAMES = ['HEAD', 'index', 'config', 'packed-refs', 'commondir', 'hooks', 'refs'];
const REVIEW_HASH_MAX_ENTRIES = 100_000;
const REVIEW_HASH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const REVIEW_HASH_MAX_DEPTH = 64;
const LEASE_POLL_INITIAL_MS = 1_000;
const LEASE_POLL_MAX_MS = 5_000;
const LEASE_RELEASE_ATTEMPTS = 3;

/** Bind the independent review to one immutable workspace view. The upstream
 * Claude provider runs in plan mode; this second boundary detects any file,
 * mode, directory, or symlink change if that provider ever violates it. */
export function hashReviewWorkspace(root) {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  let entries = 0;
  let bytes = 0;

  const hashPath = (path, label, depth) => {
    if (depth > REVIEW_HASH_MAX_DEPTH) {
      throw new Error('major-workstation: review workspace exceeds directory depth limit');
    }
    const stat = lstatSync(path);
    entries += 1;
    if (entries > REVIEW_HASH_MAX_ENTRIES) {
      throw new Error('major-workstation: review workspace exceeds entry limit');
    }
    if (stat.isDirectory()) {
      hash.update(`d\0${label}\0${stat.mode & 0o777}\0`);
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (REVIEW_HASH_EXCLUSIONS.has(entry.name)) continue;
        const childPath = join(path, entry.name);
        const childLabel = `${label}/${entry.name}`;
        if (entry.name === '.git') hashGitState(childPath, childLabel);
        else hashPath(childPath, childLabel, depth + 1);
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > REVIEW_HASH_MAX_BYTES) {
        throw new Error('major-workstation: review workspace exceeds byte limit');
      }
      hash.update(`f\0${label}\0${stat.mode & 0o777}\0`);
      hash.update(readFileSync(path));
    } else if (stat.isSymbolicLink()) {
      hash.update(`l\0${label}\0${readlinkSync(path)}\0`);
    } else {
      throw new Error(`major-workstation: unsupported review workspace object: ${label}`);
    }
  };

  const hashGitDirectory = (gitDirectory, label) => {
    for (const name of GIT_CONTROL_NAMES) {
      const path = join(gitDirectory, name);
      if (existsSync(path)) hashPath(path, `${label}/${name}`, 1);
    }
    const commonDirFile = join(gitDirectory, 'commondir');
    if (!existsSync(commonDirFile)) return;
    const commonDirectory = resolve(gitDirectory, readFileSync(commonDirFile, 'utf8').trim());
    for (const name of ['config', 'packed-refs', 'hooks', 'refs']) {
      const path = join(commonDirectory, name);
      if (existsSync(path)) hashPath(path, `${label}/common/${name}`, 1);
    }
  };

  const hashGitState = (gitPath, label) => {
    const stat = lstatSync(gitPath);
    if (stat.isDirectory()) {
      hash.update(`git\0${label}\0`);
      hashGitDirectory(gitPath, label);
      return;
    }
    if (!stat.isFile()) {
      hashPath(gitPath, label, 0);
      return;
    }
    hashPath(gitPath, label, 0);
    const pointer = readFileSync(gitPath, 'utf8')
      .trim()
      .match(/^gitdir:\s*(.+)$/i);
    if (pointer) hashGitDirectory(resolve(dirname(gitPath), pointer[1]), `${label}/worktree`);
  };

  const visit = (directory, depth) => {
    if (depth > REVIEW_HASH_MAX_DEPTH) {
      throw new Error('major-workstation: review workspace exceeds directory depth limit');
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (REVIEW_HASH_EXCLUSIONS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const label = relative(canonicalRoot, path);
      if (entry.name === '.git' && directory === canonicalRoot) {
        hashGitState(path, label);
      } else {
        hashPath(path, label, depth);
      }
    }
  };

  visit(canonicalRoot, 0);
  return hash.digest('hex');
}

function sessionHost() {
  const host = process.env.MAJOR_SESSION_HOST;
  if (!SESSION_HOSTS.has(host)) {
    throw new Error(
      'major-workstation: set MAJOR_SESSION_HOST to claude, codex, cursor, or antigravity; Major run still routes the worker',
    );
  }
  return host;
}

function clip(value, limit = RESULT_LIMIT) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function textContent(blocks) {
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Read Major's last explicitly refreshed Codex snapshot for DSH's supported
 * provider/model status surfaces. This is display-only: it never starts Codex,
 * refreshes credentials, or changes Major routing eligibility. */
export function codexComposerReadiness(env = process.env) {
  const home = env.MAJOR_HOME || (env.HOME ? join(env.HOME, '.major') : undefined);
  const path = env.MAJOR_CODEX_USAGE_PATH || (home ? join(home, 'codex-usage.json') : undefined);
  if (!path || !existsSync(path)) {
    return {
      name: 'Major',
      description: 'Codex readiness unavailable — refresh with major provider usage',
    };
  }
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    if (!report || !Array.isArray(report.accounts) || typeof report.fetchedAt !== 'string') {
      throw new Error('invalid snapshot');
    }
    const ready = report.accounts.filter(
      (account) =>
        account &&
        typeof account.accountLabel === 'string' &&
        !account.error &&
        account.primary &&
        (!Number.isFinite(account.primary?.usedPercent) || account.primary.usedPercent < 100),
    );
    const total = report.accounts.length;
    const labels = ready.map((account) => account.accountLabel).join(', ');
    return {
      name: `Major — Codex ${ready.length}/${total} ready`,
      description:
        `${labels || 'no ready accounts'}; fetched ${report.fetchedAt}; ` +
        'live via account/read + account/rateLimits/read; refresh: major provider usage',
    };
  } catch {
    return {
      name: 'Major',
      description: 'Codex readiness snapshot is invalid — refresh with major provider usage',
    };
  }
}

function majorExecutable() {
  if (process.env.MAJOR_BIN) return process.env.MAJOR_BIN;
  const home = process.env.HOME;
  if (!home) throw new Error('major-workstation: HOME is required to resolve the Major CLI');
  return join(home, '.local', 'bin', 'major');
}

async function runProcess(ctx, cwd, argv, signal) {
  const child = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: OUTPUT_LIMIT },
      stderr: { maxBytes: OUTPUT_LIMIT },
    },
    graceMs: 3_000,
    signal,
  });
  const outcome = await child.done;
  const stdout = child.collected.stdout?.readFrom(0).text ?? '';
  if (outcome.exitCode !== 0) {
    throw new Error(
      `major-workstation: ${argv[1] ?? 'command'} failed with exit ${String(outcome.exitCode)}`,
    );
  }
  return stdout;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`major-workstation: ${label} returned invalid JSON`);
  }
}

function goalCycle(goal, label) {
  const cycle = goal?.cycle;
  if (typeof cycle !== 'number' || !Number.isFinite(cycle)) {
    throw new Error(`major-workstation: ${label} returned a non-numeric goal cycle`);
  }
  return cycle;
}

export function foregroundDispatchHops(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .findLast((candidate) => candidate.startsWith(FOREGROUND_DISPATCH_PREFIX));
  if (!line) throw new Error('major-workstation: Major run returned no dispatch receipt');
  const receipt = parseJson(
    line.slice(FOREGROUND_DISPATCH_PREFIX.length).trim(),
    'dispatch receipt',
  );
  if (!Number.isInteger(receipt?.hops) || receipt.hops < 0) {
    throw new Error('major-workstation: Major run returned an invalid dispatch receipt');
  }
  return receipt.hops;
}

export function configuredRuntimeRoute(env = process.env) {
  const environment = env.MAJOR_DSH_EXECUTION_ENVIRONMENT;
  if (environment === undefined || environment === '' || environment === 'local') {
    return { environment: 'local' };
  }
  if (environment === 'legacy') return undefined;
  if (environment !== 'local' && environment !== 'lima') {
    throw new Error(`major-workstation: unsupported DSH execution environment: ${environment}`);
  }
  return { environment };
}

export function dshAdapterForMajorHost(host, environment = 'local', accountLabel = 'default') {
  if (host === 'codex') {
    if (environment === 'lima') return 'codex-lima';
    return accountLabel === 'default' ? 'codex' : `codex-${accountLabel}`;
  }
  if (host === 'claude') return 'claude-review';
  throw new Error(
    `major-workstation: Major selected ${String(host)}, which has no live DSH adapter`,
  );
}

async function acquireWorkerLease(ctx, major, goal, maxRunMinutes, signal) {
  const owner = `dsh-goal-${goal.id}`;
  let pollMs = LEASE_POLL_INITIAL_MS;
  for (;;) {
    signal.throwIfAborted();
    const result = parseJson(
      await runProcess(
        ctx,
        goal.repoPath,
        [
          major,
          'resource',
          'acquire',
          '--kind',
          'worker',
          '--owner',
          owner,
          '--project',
          goal.project,
          '--pid',
          String(process.pid),
          '--ttl-minutes',
          String(maxRunMinutes + 5),
        ],
        signal,
      ),
      'resource acquire',
    );
    if (result.status === 'active' && typeof result.lease?.id === 'string') {
      return result.lease;
    }
    if (result.status !== 'queued') {
      throw new Error(
        `major-workstation: worker resource refused: ${String(result.reason ?? 'unknown reason')}`,
      );
    }
    await new Promise((resolveWait, rejectWait) => {
      const complete = () => {
        signal.removeEventListener('abort', abort);
        resolveWait();
      };
      const timer = setTimeout(complete, pollMs);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        rejectWait(signal.reason ?? new Error('major-workstation: resource wait aborted'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer.unref?.();
    });
    pollMs = Math.min(pollMs * 2, LEASE_POLL_MAX_MS);
  }
}

function withRoutedContext(selection, goalId, lease, callback) {
  return withRoutedExecutionContext(
    {
      goalId,
      accountLabel: selection.accountLabel,
      modelRef: selection.modelRef,
      leaseId: lease.id,
      leasePid: String(process.pid),
    },
    callback,
  );
}

async function releaseWorkerLease(ctx, major, cwd, lease) {
  let lastError;
  for (let attempt = 1; attempt <= LEASE_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await runProcess(
        ctx,
        cwd,
        [major, 'resource', 'release', '--lease', lease.id, '--json'],
        undefined,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < LEASE_RELEASE_ATTEMPTS) {
        await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 250));
      }
    }
  }
  throw lastError;
}

export function nativeWorkerTask(task, resolvedSkills = [], skillResolutionDegraded = false) {
  const skillContext = skillResolutionDegraded
    ? 'Major skill and GBrain resolution is temporarily unavailable. Continue without it and report the degraded context if material.'
    : resolvedSkills.length === 0
      ? 'No existing Major or GBrain-generated skill matched this task.'
      : resolvedSkills
          .map(
            (skill) =>
              `--- MAJOR SKILL ${String(skill.id)} (${String(skill.source)}) ---\n${String(skill.content)}`,
          )
          .join('\n\n');
  return `MAJOR LEAF WORKER CONTRACT:
Major has already admitted this goal and selected you through the DSH runtime. You are the leased leaf worker, not the control-plane coordinator. Do not run Major CLI commands, admit or dispatch another goal, or delegate to another worker. Perform the task directly in the current workspace, run its verification, and report the observed result.

RESOLVED MAJOR SKILLS AND GBRAIN CONTEXT:
${skillContext}

TASK:
${task}`;
}

async function admitMajorTask(ctx, cwd, task, signal) {
  const major = majorExecutable();
  const host = sessionHost();
  await runProcess(ctx, cwd, [major, 'session', 'attach', '--cwd', cwd, '--host', host], signal);
  const admitted = parseJson(
    await runProcess(
      ctx,
      cwd,
      [major, 'goal', 'admit', '--cwd', cwd, '--host', host, '--outcome', task],
      signal,
    ),
    'goal admit',
  );
  if (admitted.admitted !== true || typeof admitted.goalId !== 'string') {
    throw new Error(`major-workstation: ${String(admitted.reason ?? 'goal admission refused')}`);
  }
  if (admitted.ownLiveWork !== true) {
    throw new Error('major-workstation: another Major session owns live work for this goal');
  }
  return { major, host, admitted };
}

async function executeMajor(ctx, cwd, task, signal) {
  const { major, admitted } = await admitMajorTask(ctx, cwd, task, signal);
  const beforeGoal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show before run',
  );
  const beforeCycle = goalCycle(beforeGoal, 'goal show before run');
  if (typeof beforeGoal?.project !== 'string' || !beforeGoal.project) {
    throw new Error('major-workstation: goal show before run returned no project identity');
  }
  const runStdout = await runProcess(
    ctx,
    cwd,
    [major, 'run', beforeGoal.project, '--goal-id', admitted.goalId, '--foreground'],
    signal,
  );
  if (foregroundDispatchHops(runStdout) === 0) {
    throw new Error(
      'major-workstation: Major run completed without dispatching a cycle; another integration owner may hold the repo lock',
    );
  }
  const goal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show',
  );
  const afterCycle = goalCycle(goal, 'goal show');
  if (afterCycle <= beforeCycle) {
    throw new Error('major-workstation: Major run completed without advancing the goal cycle');
  }
  return {
    goalId: admitted.goalId,
    status: typeof goal.status === 'string' ? goal.status : 'unknown',
    coordinator: typeof goal.lastCoordinator === 'string' ? goal.lastCoordinator : 'unknown',
    account: typeof goal.lastAccountLabel === 'string' ? goal.lastAccountLabel : 'unknown',
  };
}

async function executeNativeDsh(ctx, cwd, task, parent, signal, route) {
  const { major, admitted } = await admitMajorTask(ctx, cwd, task, signal);
  const goal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show before native run',
  );
  if (
    goal.id !== admitted.goalId ||
    goal.repoPath !== cwd ||
    typeof goal.project !== 'string' ||
    !goal.project
  ) {
    throw new Error('major-workstation: admitted goal does not match the DSH project directory');
  }
  const selection = parseJson(
    await runProcess(
      ctx,
      cwd,
      [
        major,
        'goal',
        'route-execution',
        '--id',
        admitted.goalId,
        '--environment',
        route.environment,
      ],
      signal,
    ),
    'goal route-execution',
  );
  if (selection.kind !== 'route') {
    throw new Error(
      `major-workstation: provider routing checkpoint: ${String(selection.reason ?? 'no eligible route')}`,
    );
  }
  if (!Number.isInteger(selection.maxRunMinutes) || selection.maxRunMinutes <= 0) {
    throw new Error('major-workstation: Major returned an invalid native run limit');
  }
  const dshProviderName = dshAdapterForMajorHost(
    selection.host,
    route.environment,
    selection.accountLabel,
  );
  const lease = await acquireWorkerLease(ctx, major, goal, selection.maxRunMinutes, signal);
  const executionSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(selection.maxRunMinutes * 60 * 1_000),
  ]);
  let executionError;
  let completedResult;
  try {
    const run = await withRoutedContext(selection, admitted.goalId, lease, () =>
      settleSubagent(
        ctx,
        dshProviderName,
        nativeWorkerTask(task, selection.resolvedSkills, selection.skillResolutionDegraded),
        parent,
        executionSignal,
      ),
    );
    if (run.stopReason !== 'completed') {
      throw new Error(
        `major-workstation: ${dshProviderName} ended with ${run.stopReason}` +
          (run.diagnostic ? `: ${run.diagnostic}` : ''),
      );
    }
    const summary = textContent(run.output) || `${dshProviderName} completed without text output`;
    await runProcess(
      ctx,
      cwd,
      [
        major,
        'goal',
        'report',
        '--id',
        admitted.goalId,
        '--status',
        'active',
        '--summary',
        clip(
          `DSH ${route.environment}/${selection.provider}/${selection.modelRef} completed: ${summary}`,
          12_000,
        ),
      ],
      signal,
    );
    completedResult = {
      goalId: admitted.goalId,
      status: 'active',
      coordinator: selection.host,
      account: selection.accountLabel,
      runtime: 'dsh',
      provider: selection.provider,
      model: selection.modelRef,
      environment: route.environment,
      summary,
    };
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    try {
      await releaseWorkerLease(ctx, major, cwd, lease);
    } catch (releaseError) {
      if (executionError) {
        throw new AggregateError(
          [executionError, releaseError],
          'major-workstation: native execution failed and its worker lease could not be released',
        );
      }
      completedResult.summary = clip(
        `${completedResult.summary}\n\nInfrastructure warning: the task completed, but Major could not ` +
          `release worker lease ${lease.id} after ${LEASE_RELEASE_ATTEMPTS} attempts; ` +
          'the lease remains bounded by its configured TTL.',
        12_000,
      );
    }
  }
  return completedResult;
}

export function createMajorProvider(ctx) {
  return {
    name: 'major',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request) {
      const cwd = request.parent.session.header.cwd;
      if (!cwd) throw new Error('major-workstation: the DSH session has no project directory');
      const task = textContent(request.prompt);
      if (!task) throw new Error('major-workstation: a non-empty text task is required');
      const localAbort = new AbortController();
      const signal = AbortSignal.any([request.signal, localAbort.signal]);
      const route = configuredRuntimeRoute();
      const execution = route
        ? executeNativeDsh(ctx, cwd, task, request.parent, signal, route)
        : executeMajor(ctx, cwd, task, signal);
      const result = execution.then(
        (run) => {
          const route =
            run.runtime === 'dsh'
              ? ` DSH runtime route: provider=${run.provider}; model=${run.model};` +
                ` account=${run.account}; environment=${run.environment}.` +
                ` Worker result: ${run.summary}`
              : '';
          return {
            output: [
              {
                type: 'text',
                text:
                  `Major goal ${run.goalId} finished this increment with ${run.coordinator}` +
                  ` account ${run.account}; goal status ${run.status}.${route}`,
              },
            ],
            stopReason: 'completed',
          };
        },
        (error) => ({
          output: [],
          stopReason: signal.aborted ? 'aborted' : 'error',
          diagnostic: clip(error instanceof Error ? error.message : String(error)),
        }),
      );
      return {
        id: randomUUID(),
        localAgent: undefined,
        result,
        async dispose() {
          if (!localAbort.signal.aborted) {
            localAbort.abort(new Error('major-workstation: run disposed'));
          }
          await result;
        },
      };
    },
  };
}

function latestComposerTask(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || message.source?.kind !== 'user') continue;
    const task = textContent(message.content ?? []);
    if (task) return task;
  }
  throw new Error('major-workstation: the composer request has no direct user text task');
}

/** Root DSH model adapter whose one response is an existing Major provider
 * run. Keeping this at the LLM seam gives normal composer turns ordinary DSH
 * durability, restart, chat, and trajectory behavior for free. */
export function createMajorComposerAdapter(ctx) {
  const metadata = () => codexComposerReadiness();
  return {
    providerInfo(provider) {
      return { id: provider, name: metadata().name };
    },
    providerRetryPolicy() {
      return undefined;
    },
    listModels(provider) {
      return Promise.resolve([
        {
          provider,
          id: 'composer',
          name: metadata().name,
          description: metadata().description,
          inputModalities: ['text'],
        },
      ]);
    },
    resolveModel(provider, model) {
      return Promise.resolve({
        provider,
        id: model,
        name: metadata().name,
        description: metadata().description,
        inputModalities: ['text'],
      });
    },
    async *stream(options) {
      if (!options.sessionId) {
        throw new Error('major-workstation: the composer request has no DSH session identity');
      }
      const parent = ctx.agents.get(options.sessionId);
      if (!parent) {
        throw new Error('major-workstation: the composer session has no live DSH agent');
      }
      const task = latestComposerTask(options.messages);
      const result = await executeMajorWithClaudeReview(ctx, task, parent, options.signal);
      if (result.kind !== 'success') throw new Error(result.text);
      const output = result.text;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: output };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: output } };
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
}

async function settleSubagent(ctx, provider, prompt, parent, signal) {
  const run = await ctx.subagents.start(provider, {
    prompt: [{ type: 'text', text: prompt }],
    parent,
    signal,
  });
  try {
    return await run.result;
  } finally {
    await run.dispose();
  }
}

function failedResult(provider, result) {
  const detail = result.diagnostic ? `: ${result.diagnostic}` : '';
  return {
    kind: 'error',
    text: `${provider} ended with ${result.stopReason}${detail}`,
  };
}

/** Execute one existing Major provider increment and bind an independent,
 * plan-mode Claude review to the resulting workspace. Both ordinary composer
 * turns and the diagnostic /major command use this exact execution boundary. */
export async function executeMajorWithClaudeReview(ctx, task, parent, signal) {
  const majorResult = await settleSubagent(ctx, 'major', task, parent, signal);
  if (majorResult.stopReason !== 'completed') return failedResult('Major', majorResult);

  const majorSummary = textContent(majorResult.output);
  const cwd = parent.session.header.cwd;
  if (!cwd) return { kind: 'error', text: 'The DSH session has no project directory.' };
  const beforeReview = hashReviewWorkspace(cwd);
  let reviewResult;
  try {
    reviewResult = await settleSubagent(
      ctx,
      'claude-review',
      [
        'Independently review the current repository after this Major increment.',
        'You are running in native plan mode. Inspect the diff and relevant tests without modifying files.',
        'Return a concise verdict with concrete findings.',
        `Requested task: ${task}`,
        `Major execution: ${majorSummary}`,
      ].join('\n'),
      parent,
      signal,
    );
  } finally {
    if (hashReviewWorkspace(cwd) !== beforeReview) {
      throw new Error('major-workstation: Claude review changed the project workspace');
    }
  }
  if (reviewResult.stopReason !== 'completed') return failedResult('Claude review', reviewResult);

  return {
    kind: 'success',
    text: clip(
      `${majorSummary}\n\nClaude independent review:\n${textContent(reviewResult.output)}`,
    ),
  };
}

/** Commands are log-only, but DSH rc.8 considers a persisted session blank
 * until its first turn/start. Use an otherwise empty, completed turn so the
 * upstream session list durably retains valid /major executions. */
function nextTurn(session) {
  return (
    session.events.reduce(
      (maximum, event) =>
        event.type === 'turn/start' || event.type === 'turn/end'
          ? Math.max(maximum, event.data.turn)
          : maximum,
      0,
    ) + 1
  );
}

export function apply(ctx) {
  ctx.subagents.registerProvider(createMajorProvider(ctx));
  // Production composition guarantees `llm` through `inject`; the guard keeps
  // the provider/command unit harness useful with its deliberately tiny ctx.
  ctx.llm?.registerAdapter(['major'], createMajorComposerAdapter(ctx));
  ctx.commands.register({
    name: 'major',
    description: 'run one Major increment with Codex and an independent Claude review',
    input: { hint: '<task>' },
    handler: async (invocation) => {
      const task = invocation.rawInput.trim();
      if (!task) return { kind: 'error', text: 'Usage: /major <task>' };
      const session = invocation.agent.session;
      const turn = nextTurn(session);
      session.append('turn/start', { turn });
      try {
        return await executeMajorWithClaudeReview(ctx, task, invocation.agent, invocation.signal);
      } finally {
        session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
    },
  });
}
