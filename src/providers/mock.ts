import type {
  ExecuteHandle,
  ExecuteOutcome,
  ExecuteRequest,
  ModelState,
  ProviderAdapter,
  ProviderEvent,
  ProviderInfo,
} from './types.js';

/**
 * Scripted provider for tests and dry runs. Never spawns anything and never
 * consumes tokens or credits.
 */
export interface MockProviderScript {
  name?: string;
  installed?: boolean;
  authenticated?: boolean;
  version?: string;
  models?: ModelState[];
  events?: ProviderEvent[];
  outcome?: Partial<ExecuteOutcome>;
}

export class MockProvider implements ProviderAdapter {
  readonly name: string;
  readonly executed: ExecuteRequest[] = [];
  private readonly script: MockProviderScript;

  constructor(script: MockProviderScript = {}) {
    this.script = script;
    this.name = script.name ?? 'mock';
  }

  async discover(): Promise<ProviderInfo> {
    const info: ProviderInfo = {
      name: this.name,
      installed: this.script.installed ?? true,
      authenticated: this.script.authenticated ?? true,
      models: this.script.models ?? [],
    };
    if (this.script.version !== undefined) info.version = this.script.version;
    return info;
  }

  async probe(): Promise<ProviderInfo> {
    return this.discover();
  }

  execute(request: ExecuteRequest): ExecuteHandle {
    this.executed.push(request);
    const events = this.script.events ?? [];
    const outcome: ExecuteOutcome = {
      status: 'succeeded',
      exitCode: 0,
      rateLimited: false,
      exhausted: false,
      ...this.script.outcome,
    };
    async function* stream(): AsyncGenerator<ProviderEvent> {
      for (const event of events) yield event;
    }
    return {
      events: stream(),
      cancel: () => undefined,
      outcome: Promise.resolve(outcome),
    };
  }
}
