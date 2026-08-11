import { CliProvider } from './cli-provider.js';
import type { ExecutionGateway } from '../security/gateway.js';
import type { ModelRegistry } from './registry.js';

export function cursorProvider(options: {
  gateway: ExecutionGateway;
  registry?: ModelRegistry;
}): CliProvider {
  return new CliProvider({
    name: 'cursor',
    executable: 'cursor-agent',
    gateway: options.gateway,
    ...(options.registry ? { registry: options.registry } : {}),
    args: (request) => {
      const args = [
        '-p',
        '--auto-review',
        '--sandbox',
        'enabled',
        '--output-format',
        'stream-json',
      ];
      if (request.modelRef && request.modelRef !== 'auto') args.push('--model', request.modelRef);
      if (request.resumeSessionRef) args.push(`--resume=${request.resumeSessionRef}`);
      args.push(request.prompt);
      return args;
    },
  });
}
