import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const name = 'major-workstation';
export const inject = ['commands', 'subagents', 'subprocess'];

const OUTPUT_LIMIT = 256 * 1024;
const RESULT_LIMIT = 8 * 1024;
const NO_START_CAPABILITIES = Object.freeze({});
const SESSION_HOSTS = new Set(['claude', 'codex', 'cursor', 'antigravity']);
const FOREGROUND_DISPATCH_PREFIX = 'MAJOR_FOREGROUND_DISPATCH:';

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

async function executeMajor(ctx, cwd, task, signal) {
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
      const result = executeMajor(ctx, cwd, task, signal).then(
        (run) => ({
          output: [
            {
              type: 'text',
              text:
                `Major goal ${run.goalId} finished this increment with ${run.coordinator}` +
                ` account ${run.account}; goal status ${run.status}.`,
            },
          ],
          stopReason: 'completed',
        }),
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

export function apply(ctx) {
  ctx.subagents.registerProvider(createMajorProvider(ctx));
  ctx.commands.register({
    name: 'major',
    description: 'run one Major increment with Codex and an independent Claude review',
    input: { hint: '<task>' },
    handler: async (invocation) => {
      const task = invocation.rawInput.trim();
      if (!task) return { kind: 'error', text: 'Usage: /major <task>' };

      const majorResult = await settleSubagent(
        ctx,
        'major',
        task,
        invocation.agent,
        invocation.signal,
      );
      if (majorResult.stopReason !== 'completed') return failedResult('Major', majorResult);

      const majorSummary = textContent(majorResult.output);
      const reviewResult = await settleSubagent(
        ctx,
        'claude-code',
        [
          'Independently review the current repository after this Major increment.',
          'Do not modify files. Inspect the diff and relevant tests.',
          'Return a concise verdict with concrete findings.',
          `Requested task: ${task}`,
          `Major execution: ${majorSummary}`,
        ].join('\n'),
        invocation.agent,
        invocation.signal,
      );
      if (reviewResult.stopReason !== 'completed')
        return failedResult('Claude review', reviewResult);

      return {
        kind: 'success',
        text: clip(
          `${majorSummary}\n\nClaude independent review:\n${textContent(reviewResult.output)}`,
        ),
      };
    },
  });
}
