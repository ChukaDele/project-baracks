import type { ExecuteRequest } from './types.js';

export type ProviderCommandHost = 'claude' | 'codex' | 'cursor' | 'antigravity';
export type ProviderOutputMode = 'batch' | 'stream';

export interface ProviderCommandRequest {
  prompt: string;
  modelRef?: string | undefined;
  resumeSessionRef?: string | undefined;
  outputMode: ProviderOutputMode;
}

export const RATE_LIMIT_PATTERN = /rate.?limit|overloaded|429|too many requests|slow down/i;
export const EXHAUSTION_PATTERN = /usage limit|quota exceeded|out of credits|allowance|plan limit/i;

export function providerExecutable(host: ProviderCommandHost): string {
  switch (host) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'cursor':
      return 'cursor-agent';
    case 'antigravity':
      return 'agy';
  }
}

export function providerArgs(host: ProviderCommandHost, request: ProviderCommandRequest): string[] {
  switch (host) {
    case 'claude': {
      const args = [
        '-p',
        request.prompt,
        '--output-format',
        request.outputMode === 'stream' ? 'stream-json' : 'json',
        ...(request.outputMode === 'stream' ? ['--verbose'] : ['--max-turns', '80']),
        '--permission-mode',
        'auto',
        '--safe-mode',
        '--no-chrome',
      ];
      if (request.resumeSessionRef) args.push('--resume', request.resumeSessionRef);
      else args.push('--no-session-persistence');
      if (request.modelRef && request.modelRef !== 'auto') args.push('--model', request.modelRef);
      return args;
    }
    case 'codex': {
      const args = request.resumeSessionRef
        ? [
            'exec',
            '--sandbox',
            'workspace-write',
            '--ignore-user-config',
            'resume',
            request.resumeSessionRef,
            '--json',
            request.prompt,
          ]
        : [
            'exec',
            '--sandbox',
            'workspace-write',
            '--ignore-user-config',
            '--ephemeral',
            '--json',
            request.prompt,
          ];
      if (request.modelRef && request.modelRef !== 'auto') {
        args.splice(1, 0, '--model', request.modelRef);
      }
      return args;
    }
    case 'cursor': {
      const args = [
        '-p',
        '--auto-review',
        '--sandbox',
        'enabled',
        '--output-format',
        request.outputMode === 'stream' ? 'stream-json' : 'json',
      ];
      if (request.modelRef && request.modelRef !== 'auto') args.push('--model', request.modelRef);
      if (request.resumeSessionRef) args.push(`--resume=${request.resumeSessionRef}`);
      args.push(request.prompt);
      return args;
    }
    case 'antigravity': {
      const args: string[] = [
        '--output-format',
        request.outputMode === 'stream' ? 'stream-json' : 'json',
      ];
      if (request.resumeSessionRef) args.push('--conversation', request.resumeSessionRef);
      if (request.modelRef && request.modelRef !== 'auto') args.push('--model', request.modelRef);
      args.push('-p', request.prompt);
      return args;
    }
  }
}

export function providerExecuteArgs(host: ProviderCommandHost, request: ExecuteRequest): string[] {
  return providerArgs(host, { ...request, outputMode: 'stream' });
}
