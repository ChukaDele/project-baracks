import { CliProvider } from './cli-provider.js';
import type { ExecutionGateway } from '../security/gateway.js';
import type { ModelRegistry } from './registry.js';
import type { ExecuteRequest } from './types.js';

export function antigravityArgs(request: ExecuteRequest): string[] {
  const args: string[] = [];
  if (request.resumeSessionRef) args.push('--conversation', request.resumeSessionRef);
  if (request.modelRef && request.modelRef !== 'auto') args.push('--model', request.modelRef);
  args.push('-p', request.prompt);
  return args;
}

export function antigravityProvider(options: {
  gateway: ExecutionGateway;
  registry?: ModelRegistry;
}): CliProvider {
  return new CliProvider({
    name: 'antigravity',
    executable: 'agy',
    gateway: options.gateway,
    ...(options.registry ? { registry: options.registry } : {}),
    args: antigravityArgs,
  });
}
