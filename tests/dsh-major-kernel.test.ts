import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

interface KernelProvider {
  start(request: KernelRequest): Promise<KernelRun>;
}

interface KernelRequest {
  prompt: Array<{ type: string; text: string }>;
  parent: { session: KernelSession };
  signal: AbortSignal;
}

interface KernelSession {
  header: { cwd?: string };
  events: Array<{ type: string; data: Record<string, unknown> }>;
  append(type: string, data: Record<string, unknown>): void;
}

interface KernelRun {
  result: Promise<{
    output: Array<{ type: string; text: string }>;
    stopReason: string;
    diagnostic?: string;
  }>;
  dispose(): Promise<void>;
}

interface KernelCommand {
  handler(invocation: {
    rawInput: string;
    agent: KernelRequest['parent'];
    signal: AbortSignal;
  }): Promise<{ kind: string; text: string }>;
}

interface CommandInputDefinition {
  kind?: string;
  match(event: Record<string, unknown>): { id: string; role: string } | null;
  start(context: unknown, match: Record<string, unknown>): Record<string, unknown>;
  update(context: { state: unknown }, match?: Record<string, unknown>): unknown;
  buildViewNode(context: Record<string, unknown>): Record<string, unknown> | null;
}

function kernelSession(cwd?: string, seed: KernelSession['events'] = []): KernelSession {
  const events = [...seed];
  return {
    header: { ...(cwd === undefined ? {} : { cwd }) },
    events,
    append(type, data) {
      events.push({ type, data });
    },
  };
}

async function loadKernel(): Promise<{
  apply(ctx: unknown): void;
  foregroundDispatchHops(stdout: string): number;
  hashReviewWorkspace(root: string): string;
}> {
  const url = pathToFileURL(
    resolve('distribution/deepseek-harness/bundles/major-kernel/index.js'),
  ).href;
  return (await import(url)) as {
    apply(ctx: unknown): void;
    foregroundDispatchHops(stdout: string): number;
    hashReviewWorkspace(root: string): string;
  };
}

function loadKernelClient(): {
  inject: string[];
  apply(ctx: { conversationEvents: { register(definition: unknown): void } }): void;
} {
  let entry: { id: string; factory(require: unknown): unknown } | undefined;
  const source = readFileSync(
    resolve('distribution/deepseek-harness/bundles/major-kernel/client.js'),
    'utf8',
  );
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(value: typeof entry) {
          entry = value;
        },
      },
    },
  });
  expect(entry?.id).toBe('@major/dsh-kernel');
  return entry?.factory(undefined) as never;
}

function processHandle(stdout: string, exitCode = 0) {
  return {
    done: Promise.resolve({ exitCode, signal: null }),
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
  };
}

describe('Major DSH workstation kernel', () => {
  const previousHost = process.env.MAJOR_SESSION_HOST;
  const temporaryRoots: string[] = [];

  afterEach(() => {
    if (previousHost === undefined) delete process.env.MAJOR_SESSION_HOST;
    else process.env.MAJOR_SESSION_HOST = previousHost;
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('replays /major command input before its generic durable result without model messages', async () => {
    const client = loadKernelClient();
    const definitions: CommandInputDefinition[] = [];
    client.apply({
      conversationEvents: {
        register: (definition) => definitions.push(definition as CommandInputDefinition),
      },
    });
    const majorCommandInputDefinition = definitions.find(
      (definition) => definition.kind === 'major-command-input',
    );
    const majorTrajectoryDefinition = definitions.find(
      (definition) => definition.kind === 'major-command-trajectory',
    );
    if (!majorCommandInputDefinition) throw new Error('Major projection was not registered');
    if (!majorTrajectoryDefinition) throw new Error('Major trajectory was not registered');
    const run = {
      seq: 7,
      time: 1_700_000_000_007,
      type: 'command/run',
      data: {
        commandId: 'command-major',
        name: 'major',
        args: ' ship the durable result  \n',
        source: { kind: 'user' },
      },
    };
    const done = {
      seq: 8,
      time: 1_700_000_000_008,
      type: 'command/done',
      data: {
        commandId: 'command-major',
        kind: 'success',
        text: 'Major result\n\nClaude independent review: PASS',
      },
    };
    const match = majorCommandInputDefinition.match(run);
    expect(match).toEqual({ id: 'command-major', role: 'start' });
    expect(majorCommandInputDefinition.match(done)).toBeNull();
    expect(
      majorCommandInputDefinition.match({
        ...run,
        data: { ...run.data, commandId: 'command-goal', name: 'goal' },
      }),
    ).toBeNull();
    const state = majorCommandInputDefinition.start(
      {},
      {
        event: run,
        location: { kind: 'session' },
      },
    );
    expect(majorCommandInputDefinition.update({ state })).toBe(state);
    const view = majorCommandInputDefinition.buildViewNode({
      key: 'major-command-input:command-major',
      id: 'command-major',
      state,
      start: { location: { kind: 'session' } },
    });
    expect(view).toMatchObject({
      kind: 'command-input',
      anchorSeq: 6.9,
      visibility: 'visible',
      data: { text: '/major ship the durable result' },
    });
    const trajectoryMatch = majorTrajectoryDefinition.match(run);
    if (!trajectoryMatch) throw new Error('Major trajectory did not match command/run');
    const trajectoryStart = majorTrajectoryDefinition.start({}, { event: run });
    const trajectoryState = majorTrajectoryDefinition.update(
      { state: trajectoryStart },
      { event: done },
    );
    const trajectoryView = majorTrajectoryDefinition.buildViewNode({
      key: 'major-command-trajectory:command-major',
      kind: 'major-command-trajectory',
      id: trajectoryMatch.id,
      state: trajectoryState,
      start: { location: { kind: 'turn' } },
    });
    expect(trajectoryView).toMatchObject({
      target: 'trajectory',
      anchorSeq: 8,
      data: {
        kind: 'tool',
        root: {
          kind: 'tool-result',
          callId: 'command-major',
          call: { name: 'major', argsRaw: ' ship the durable result  \n' },
          content: [{ type: 'text', text: 'Major result\n\nClaude independent review: PASS' }],
          isError: false,
        },
      },
    });

    // A fresh browser materializes the factory again and receives the same
    // durable events from DSH; no Major-owned session state participates.
    const restartedDefinitions: CommandInputDefinition[] = [];
    loadKernelClient().apply({
      conversationEvents: {
        register: (definition) => restartedDefinitions.push(definition as CommandInputDefinition),
      },
    });
    const restartedDefinition = restartedDefinitions.find(
      (definition) => definition.kind === 'major-command-input',
    );
    if (!restartedDefinition) throw new Error('Restarted Major projection was not registered');
    const restartedMatch = restartedDefinition.match(run);
    if (!restartedMatch) throw new Error('Restarted Major projection did not match command/run');
    const restartedState = restartedDefinition.start({}, { event: run });
    expect(
      restartedDefinition.buildViewNode({
        key: 'major-command-input:command-major',
        id: restartedMatch.id,
        state: restartedState,
        start: { location: { kind: 'session' } },
      }),
    ).toEqual(view);
    const restartedTrajectory = restartedDefinitions.find(
      (definition) => definition.kind === 'major-command-trajectory',
    );
    if (!restartedTrajectory) throw new Error('Restarted trajectory was not registered');
    const restartedTrajectoryMatch = restartedTrajectory.match(run);
    if (!restartedTrajectoryMatch) throw new Error('Restarted trajectory did not match run');
    const restartedTrajectoryState = restartedTrajectory.update(
      { state: restartedTrajectory.start({}, { event: run }) },
      { event: done },
    );
    expect(
      restartedTrajectory.buildViewNode({
        key: 'major-command-trajectory:command-major',
        kind: 'major-command-trajectory',
        id: restartedTrajectoryMatch.id,
        state: restartedTrajectoryState,
        start: { location: { kind: 'turn' } },
      }),
    ).toEqual(trajectoryView);
    expect(majorCommandInputDefinition.buildViewNode({ state: undefined })).toBeNull();
    expect(JSON.stringify([run, done])).not.toMatch(/user\/message|turn\/start|step\/start/);
  });

  it('registers only projections that delegate to upstream chat and trajectory targets', async () => {
    const client = loadKernelClient();
    const registered: unknown[] = [];
    client.apply({
      conversationEvents: {
        register(definition) {
          registered.push(definition);
        },
      },
    });

    expect(client.inject).toEqual(['conversationEvents']);
    expect(registered).toHaveLength(2);
    expect(registered[0]).toMatchObject({ kind: 'major-command-input', target: 'chat' });
    expect(registered[1]).toMatchObject({
      kind: 'major-command-trajectory',
      target: 'trajectory',
    });
  });

  it('admits through the attaching session host, then records an independent Claude review', async () => {
    process.env.MAJOR_SESSION_HOST = 'cursor';
    const projectRoot = mkdtempSync(join(tmpdir(), 'major-dsh-kernel-project-'));
    temporaryRoots.push(projectRoot);
    writeFileSync(join(projectRoot, 'reviewed.txt'), 'stable');
    const argv: string[][] = [];
    let goalShowCalls = 0;
    let majorProvider: KernelProvider | undefined;
    let majorCommand: KernelCommand | undefined;
    const subprocess = {
      spawn(spec: { argv: string[] }) {
        argv.push(spec.argv);
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'admit') {
          return processHandle(
            JSON.stringify({ admitted: true, goalId: 'goal-1', ownLiveWork: true }),
          );
        }
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'show') {
          goalShowCalls += 1;
          return processHandle(
            JSON.stringify({
              project: 'github.com/example/project',
              status: 'active',
              lastCoordinator: 'codex',
              lastAccountLabel: 'work-b',
              cycle: goalShowCalls === 1 ? 1 : 2,
            }),
          );
        }
        if (spec.argv[1] === 'run') {
          return processHandle('MAJOR_FOREGROUND_DISPATCH: {"hops":1}\n');
        }
        return processHandle('');
      },
    };
    const subagents = {
      registerProvider(provider: KernelProvider) {
        majorProvider = provider;
      },
      async start(provider: string, request: KernelRequest): Promise<KernelRun> {
        if (provider === 'major') {
          if (!majorProvider) throw new Error('Major provider was not registered');
          return majorProvider.start(request);
        }
        expect(provider).toBe('claude-review');
        return {
          result: Promise.resolve({
            output: [{ type: 'text', text: 'VERDICT: PASS\nNo findings.' }],
            stopReason: 'completed',
          }),
          async dispose() {},
        };
      },
    };
    const commands = {
      register(command: KernelCommand) {
        majorCommand = command;
      },
    };
    const kernel = await loadKernel();
    kernel.apply({ subprocess, subagents, commands });
    if (!majorCommand) throw new Error('Major command was not registered');

    const session = kernelSession(projectRoot, [
      { type: 'turn/start', data: { turn: 4 } },
      { type: 'turn/end', data: { turn: 4, reason: { kind: 'completed' } } },
    ]);
    const result = await majorCommand.handler({
      rawInput: 'implement the acceptance change',
      agent: { session },
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe('success');
    expect(result.text).toContain('finished this increment with codex account work-b');
    expect(result.text).toContain('Claude independent review:\nVERDICT: PASS');
    expect(goalShowCalls).toBe(2);
    expect(argv.map((args) => args.slice(1, 4))).toEqual([
      ['session', 'attach', '--cwd'],
      ['goal', 'admit', '--cwd'],
      ['goal', 'show', '--id'],
      ['run', 'github.com/example/project', '--goal-id'],
      ['goal', 'show', '--id'],
    ]);
    expect(argv[0]?.includes('--host') && argv[0]?.includes('cursor')).toBe(true);
    expect(argv[1]?.includes('--host') && argv[1]?.includes('cursor')).toBe(true);
    expect(argv[3]?.includes('--host')).toBe(false);
    expect(session.events.slice(-2)).toEqual([
      { type: 'turn/start', data: { turn: 5 } },
      { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } },
    ]);
    expect(JSON.stringify(session.events.slice(-2))).not.toMatch(
      /user\/message|assistant\/message|step\/start|step\/end/,
    );
  });

  it('returns a Major error without starting Claude when foreground dispatch runs zero hops', async () => {
    process.env.MAJOR_SESSION_HOST = 'cursor';
    const providersStarted: string[] = [];
    let majorProvider: KernelProvider | undefined;
    let majorCommand: KernelCommand | undefined;
    const subprocess = {
      spawn(spec: { argv: string[] }) {
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'admit') {
          return processHandle(
            JSON.stringify({ admitted: true, goalId: 'goal-1', ownLiveWork: true }),
          );
        }
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'show') {
          return processHandle(
            JSON.stringify({
              project: 'github.com/example/project',
              status: 'active',
              lastCoordinator: 'codex',
              lastAccountLabel: 'work-b',
              cycle: 3,
            }),
          );
        }
        if (spec.argv[1] === 'run') {
          return processHandle('MAJOR_FOREGROUND_DISPATCH: {"hops":0}\n');
        }
        return processHandle('');
      },
    };
    const subagents = {
      registerProvider(provider: KernelProvider) {
        majorProvider = provider;
      },
      async start(provider: string, request: KernelRequest): Promise<KernelRun> {
        providersStarted.push(provider);
        if (provider === 'major') {
          if (!majorProvider) throw new Error('Major provider was not registered');
          return majorProvider.start(request);
        }
        throw new Error('Claude review must not start after a zero-hop Major run');
      },
    };
    const commands = {
      register(command: KernelCommand) {
        majorCommand = command;
      },
    };
    const kernel = await loadKernel();
    kernel.apply({ subprocess, subagents, commands });
    if (!majorCommand) throw new Error('Major command was not registered');

    const session = kernelSession('/tmp/project');
    const result = await majorCommand.handler({
      rawInput: 'implement the acceptance change',
      agent: { session },
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe('error');
    expect(result.text).toContain('Major ended with error');
    expect(result.text).toContain('without dispatching a cycle');
    expect(providersStarted).toEqual(['major']);
    expect(session.events).toEqual([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]);
  });

  it('fails the command if the plan-mode Claude reviewer changes the workspace', async () => {
    process.env.MAJOR_SESSION_HOST = 'cursor';
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-review-boundary-'));
    const target = join(root, 'reviewed.txt');
    writeFileSync(target, 'before');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
    let majorProvider: KernelProvider | undefined;
    let majorCommand: KernelCommand | undefined;
    let goalShowCalls = 0;
    const subprocess = {
      spawn(spec: { argv: string[] }) {
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'admit') {
          return processHandle(
            JSON.stringify({ admitted: true, goalId: 'goal-1', ownLiveWork: true }),
          );
        }
        if (spec.argv[1] === 'goal' && spec.argv[2] === 'show') {
          goalShowCalls += 1;
          return processHandle(
            JSON.stringify({
              project: 'github.com/example/project',
              status: 'active',
              lastCoordinator: 'codex',
              lastAccountLabel: 'work-b',
              cycle: goalShowCalls === 1 ? 1 : 2,
            }),
          );
        }
        if (spec.argv[1] === 'run') {
          return processHandle('MAJOR_FOREGROUND_DISPATCH: {"hops":1}\n');
        }
        return processHandle('');
      },
    };
    const kernel = await loadKernel();
    try {
      kernel.apply({
        subprocess,
        subagents: {
          registerProvider(provider: KernelProvider) {
            majorProvider = provider;
          },
          async start(provider: string, request: KernelRequest): Promise<KernelRun> {
            if (provider === 'major') {
              if (!majorProvider) throw new Error('Major provider was not registered');
              return majorProvider.start(request);
            }
            expect(provider).toBe('claude-review');
            writeFileSync(
              join(root, '.git', 'config'),
              '[core]\n\trepositoryformatversion = 0\n\thooksPath = /tmp/reviewer-hooks\n',
            );
            return {
              result: Promise.resolve({
                output: [{ type: 'text', text: 'VERDICT: PASS' }],
                stopReason: 'completed',
              }),
              async dispose() {},
            };
          },
        },
        commands: { register: (command: KernelCommand) => (majorCommand = command) },
      });
      if (!majorCommand) throw new Error('Major command was not registered');
      const session = kernelSession(root);
      await expect(
        majorCommand.handler({
          rawInput: 'implement the acceptance change',
          agent: { session },
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/Claude review changed the project workspace/);
      expect(session.events).toEqual([
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses /major when MAJOR_SESSION_HOST is missing instead of pinning Codex', async () => {
    delete process.env.MAJOR_SESSION_HOST;
    let majorProvider: KernelProvider | undefined;
    let majorCommand: KernelCommand | undefined;
    const kernel = await loadKernel();
    kernel.apply({
      subprocess: {
        spawn() {
          throw new Error('must not spawn Major until a session host is set');
        },
      },
      subagents: {
        registerProvider(provider: KernelProvider) {
          majorProvider = provider;
        },
        async start(provider: string, request: KernelRequest): Promise<KernelRun> {
          if (provider !== 'major' || !majorProvider) throw new Error('Major provider missing');
          return majorProvider.start(request);
        },
      },
      commands: { register: (command: KernelCommand) => (majorCommand = command) },
    });
    if (!majorCommand) throw new Error('Major command was not registered');
    await expect(
      majorCommand.handler({
        rawInput: 'implement the acceptance change',
        agent: { session: kernelSession('/tmp/project') },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      kind: 'error',
      text: expect.stringContaining('MAJOR_SESSION_HOST'),
    });
  });

  it('parses only the structured foreground dispatch receipt', async () => {
    const kernel = await loadKernel();
    expect(kernel.foregroundDispatchHops('noise\nMAJOR_FOREGROUND_DISPATCH: {"hops":2}\n')).toBe(2);
    expect(() => kernel.foregroundDispatchHops('supervisor: no cycle actually ran')).toThrow(
      /no dispatch receipt/,
    );
  });

  it('rejects an empty command without starting a provider', async () => {
    let majorCommand: KernelCommand | undefined;
    const kernel = await loadKernel();
    kernel.apply({
      subprocess: { spawn: () => processHandle('') },
      subagents: {
        registerProvider() {},
        start: () => {
          throw new Error('must not start');
        },
      },
      commands: { register: (command: KernelCommand) => (majorCommand = command) },
    });
    if (!majorCommand) throw new Error('Major command was not registered');
    await expect(
      majorCommand.handler({
        rawInput: '   ',
        agent: { session: kernelSession('/tmp/project') },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'error', text: 'Usage: /major <task>' });
  });
});
