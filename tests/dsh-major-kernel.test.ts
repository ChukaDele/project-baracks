import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

interface KernelProvider {
  start(request: KernelRequest): Promise<KernelRun>;
}

interface KernelRequest {
  prompt: Array<{ type: string; text: string }>;
  parent: { session: { header: { cwd?: string } } };
  signal: AbortSignal;
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

async function loadKernel(): Promise<{
  apply(ctx: unknown): void;
  foregroundDispatchHops(stdout: string): number;
}> {
  const url = pathToFileURL(
    resolve('distribution/deepseek-harness/bundles/major-kernel/index.js'),
  ).href;
  return (await import(url)) as {
    apply(ctx: unknown): void;
    foregroundDispatchHops(stdout: string): number;
  };
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

  afterEach(() => {
    if (previousHost === undefined) delete process.env.MAJOR_SESSION_HOST;
    else process.env.MAJOR_SESSION_HOST = previousHost;
  });

  it('admits through the attaching session host, then records an independent Claude review', async () => {
    process.env.MAJOR_SESSION_HOST = 'cursor';
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
        expect(provider).toBe('claude-code');
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

    const result = await majorCommand.handler({
      rawInput: 'implement the acceptance change',
      agent: { session: { header: { cwd: '/tmp/project' } } },
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

    const result = await majorCommand.handler({
      rawInput: 'implement the acceptance change',
      agent: { session: { header: { cwd: '/tmp/project' } } },
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe('error');
    expect(result.text).toContain('Major ended with error');
    expect(result.text).toContain('without dispatching a cycle');
    expect(providersStarted).toEqual(['major']);
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
        agent: { session: { header: { cwd: '/tmp/project' } } },
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
        agent: { session: { header: { cwd: '/tmp/project' } } },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'error', text: 'Usage: /major <task>' });
  });
});
