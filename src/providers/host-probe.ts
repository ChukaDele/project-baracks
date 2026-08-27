import { executeMajorCommand } from '../security/major-gateway.js';
import { providerExecutable, type ProviderCommandHost } from './commands.js';
import type { BackendProviderStatus } from '../execution/backend.js';
import type { ProviderEvent } from './types.js';

interface HostProbeSpec {
  statusArgs: string[];
  authenticated: RegExp;
}

const HOST_PROBES: Readonly<Record<ProviderCommandHost, HostProbeSpec>> = Object.freeze({
  claude: {
    statusArgs: ['auth', 'status', '--json'],
    authenticated: /(?:"loggedIn"\s*:\s*true|authenticated|logged in)/i,
  },
  codex: {
    statusArgs: ['login', 'status'],
    authenticated: /(?:logged in using|authenticated|valid api key)/i,
  },
  cursor: {
    statusArgs: ['status'],
    authenticated: /(?:authenticated|logged in|status\s*:\s*ok)/i,
  },
  antigravity: {
    statusArgs: ['auth', 'status'],
    authenticated: /(?:authenticated|logged in|signed in|oauth)/i,
  },
});

function eventText(event: ProviderEvent): string {
  return typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
}

async function runHostProbeCommand(
  host: ProviderCommandHost,
  args: readonly string[],
): Promise<{ code: number | null; output: string }> {
  const executable = providerExecutable(host);
  const handle = executeMajorCommand({
    executable,
    args,
    cwd: process.cwd(),
    allowedRoots: [process.cwd()],
    timeoutMs: 15_000,
  });
  const events: string[] = [];
  for await (const event of handle.events) events.push(eventText(event));
  const outcome = await handle.outcome;
  return {
    code: outcome.exitCode,
    output: `${events.join('\n')}\n${outcome.stderrTail ?? ''}`,
  };
}

/**
 * Probe a provider's native host CLI through Major's macOS Seatbelt path.
 * These commands report version and authentication state only. They do not
 * send a model prompt, import credentials, or write provider state.
 */
export async function probeHostProvider(host: ProviderCommandHost): Promise<BackendProviderStatus> {
  const executable = providerExecutable(host);
  const spec = HOST_PROBES[host];
  try {
    const version = await runHostProbeCommand(host, ['--version']);
    const installed = version.code !== 127 && !/not found|no such file/i.test(version.output);
    if (!installed) {
      return {
        executable,
        installed: false,
        authenticated: false,
        detail: 'provider executable is unavailable on the host path',
      };
    }
    const auth = await runHostProbeCommand(host, spec.statusArgs);
    const negative = /(?:not logged|not authenticated|unauthenticated|loggedIn"\s*:\s*false)/i;
    const authenticated =
      auth.code === 0 && spec.authenticated.test(auth.output) && !negative.test(auth.output);
    const versionMatch = version.output.match(/\d+\.\d+\.\d+/)?.[0];
    return {
      executable,
      installed: true,
      authenticated,
      detail: authenticated
        ? 'provider is installed and authenticated through the host CLI'
        : 'provider is installed but host CLI authentication was not confirmed',
      ...(versionMatch ? { version: versionMatch } : {}),
    };
  } catch (error) {
    return {
      executable,
      installed: false,
      authenticated: false,
      detail: `host provider probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
