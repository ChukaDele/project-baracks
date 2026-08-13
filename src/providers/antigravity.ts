import { CliProvider } from './cli-provider.js';
import type { ExecutionGateway } from '../security/gateway.js';
import type { ModelRegistry } from './registry.js';
import type { ExecuteRequest } from './types.js';
import { providerExecuteArgs } from './commands.js';

export function antigravityArgs(request: ExecuteRequest): string[] {
  return providerExecuteArgs('antigravity', request);
}

export function antigravityProvider(options: {
  gateway: ExecutionGateway;
  registry?: ModelRegistry;
}): CliProvider {
  return new CliProvider({
    name: 'antigravity',
    host: 'antigravity',
    executable: 'agy',
    gateway: options.gateway,
    ...(options.registry ? { registry: options.registry } : {}),
    args: antigravityArgs,
  });
}
