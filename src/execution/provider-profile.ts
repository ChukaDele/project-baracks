import type { ProviderCommandHost } from '../providers/commands.js';

export interface GuestProviderProfile {
  host: ProviderCommandHost;
  user: string;
  home: string;
  executable: string;
  probeArgs: readonly string[];
  authenticated: RegExp;
  /** The only provider-owned state shared between projects. */
  authRelativePath: string;
  /** Args that launch this provider's own native/interactive login flow
   * inside the isolated worker (e.g. a device-code flow needing no local
   * browser). Undefined for providers whose current onboarding path is host
   * credential reuse only -- populated here only once that provider's own
   * CLI login interface has actually been verified, not guessed at. */
  loginArgs?: readonly string[];
}

export type GuestProviderHost = GuestProviderProfile['host'];

const profiles: Record<ProviderCommandHost, GuestProviderProfile> = {
  claude: {
    host: 'claude',
    user: 'major-claude',
    home: '/home/major-claude',
    executable: '/opt/major/providers/v1/claude/bin/claude',
    probeArgs: ['auth', 'status'],
    authenticated: /"loggedIn"\s*:\s*true/,
    authRelativePath: '.claude/.credentials.json',
  },
  codex: {
    host: 'codex',
    user: 'major-codex',
    home: '/home/major-codex',
    executable: '/opt/major/providers/v1/codex/bin/codex-native',
    probeArgs: ['login', 'status'],
    authenticated: /logged in using chatgpt/i,
    authRelativePath: '.codex/auth.json',
    // Verified directly against the real installed Codex CLI: `codex login
    // --device-auth` prints a fixed URL and a one-time code, then blocks
    // (polling) until the user completes it in a browser or it expires
    // (~15 minutes) -- no local browser or callback port needed, which is
    // exactly what makes it usable from inside a headless isolated worker.
    loginArgs: ['login', '--device-auth'],
  },
  cursor: {
    host: 'cursor',
    user: 'major-cursor',
    home: '/home/major-cursor',
    executable: '/opt/major/providers/v1/cursor/bin/cursor-agent',
    probeArgs: ['status'],
    authenticated: /logged in/i,
    authRelativePath: '.config/cursor/auth.json',
  },
  antigravity: {
    host: 'antigravity',
    user: 'major-antigravity',
    home: '/home/major-antigravity',
    executable: '/opt/major/providers/v1/antigravity/bin/agy',
    probeArgs: ['models'],
    authenticated: /gemini|claude|gpt/i,
    authRelativePath: '.gemini/antigravity-cli/antigravity-oauth-token',
  },
};

const executableToHost: Record<string, ProviderCommandHost> = {
  claude: 'claude',
  codex: 'codex',
  'cursor-agent': 'cursor',
  agy: 'antigravity',
};

export function guestProviderProfile(executable: string): GuestProviderProfile {
  if (executable.includes('/') || executable.includes('\\')) {
    throw new Error('path-qualified provider executables are not accepted by the Lima backend');
  }
  const host = executableToHost[executable];
  if (!host) throw new Error(`unsupported Lima provider executable: ${executable}`);
  return profiles[host];
}

export function guestProjectHome(guestRun: string): string {
  if (
    !/^\/var\/lib\/major\/runs\/(claude|codex|cursor|antigravity)\/[a-f0-9-]{36}$/.test(guestRun)
  ) {
    throw new Error('unsafe guest run path for project home');
  }
  return `${guestRun}/home`;
}
