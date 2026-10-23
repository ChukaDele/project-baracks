import { executeMajorCommand } from '../security/major-gateway.js';
import { providerExecutable, type ProviderCommandHost } from './commands.js';
import type { BackendProviderStatus } from '../execution/backend.js';
import type { ProviderEvent } from './types.js';
import { hasKeychainEntry, keychainServiceName } from './host-credential.js';
import { readProviderToken } from './provider-token.js';

const TOKEN_SETUP: Partial<Record<ProviderCommandHost, string>> = {
  claude:
    'run `claude setup-token`, then pipe the printed token: `major provider import-token claude-code`',
  cursor:
    'create a Cursor User API Key (Cursor dashboard > Integrations), then pipe it: `major provider import-token cursor`',
};

/** Why the host CLI is not authenticated, with the owner's next step when known. */
function unauthenticatedDetail(host: ProviderCommandHost, output: string): string {
  if (/bind: operation not permitted/i.test(output)) {
    return (
      `sandbox-blocked: ${providerExecutable(host)} must open a localhost listener, which ` +
      "Major's Seatbelt profile denies; this needs a containment policy change, not a login"
    );
  }
  const setup = TOKEN_SETUP[host];
  if (setup && readProviderToken(host)) {
    return `the Major-held ${host} token was not accepted; replace it: ${setup}`;
  }
  const service = keychainServiceName(host);
  if (setup && service && hasKeychainEntry(service)) {
    return (
      `host-keychain-only: the ${host} login is in the macOS Keychain, which Major's sandbox ` +
      `cannot read and Major never extracts; ${setup}`
    );
  }
  return 'provider is installed but host CLI authentication was not confirmed';
}

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
    // agy has no auth/status subcommand. `models` lists the account's models
    // (no prompt is sent) and succeeds only when signed in.
    statusArgs: ['models'],
    authenticated: /^[a-z0-9][\w.-]*\t\S/m,
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
        : unauthenticatedDetail(host, auth.output),
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
