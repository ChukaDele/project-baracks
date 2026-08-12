import { CliProvider } from './cli-provider.js';
import type { ExecutionGateway } from '../security/gateway.js';
import type { ModelRegistry } from './registry.js';
import { providerExecuteArgs } from './commands.js';

export function cursorProvider(options: {
  gateway: ExecutionGateway;
  registry?: ModelRegistry;
}): CliProvider {
  return new CliProvider({
    name: 'cursor',
    host: 'cursor',
    executable: 'cursor-agent',
    gateway: options.gateway,
    allowGuestMutation: true,
    ...(options.registry ? { registry: options.registry } : {}),
    args: (request) => providerExecuteArgs('cursor', request),
  });
}
