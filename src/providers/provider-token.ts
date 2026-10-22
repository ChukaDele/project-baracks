import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { trustedMajorHome } from '#trust-roots';
import type { ProviderCommandHost } from './commands.js';

/**
 * Owner-imported headless provider tokens for the host execution path.
 *
 * On macOS, Claude Code and the Cursor CLI keep their interactive login in
 * the Keychain, which Major's Seatbelt sandbox cannot read and which Major
 * never extracts. Both CLIs also accept an official headless credential from
 * the environment. The owner creates that credential with the provider's own
 * tool and pipes it to `major provider import-token`; Major stores it in a
 * 0600 file and injects it only into that provider's own processes.
 * Nothing in this module logs, prints or returns a token outside
 * readProviderToken().
 */
const TOKEN_SLOTS: Partial<Record<ProviderCommandHost, { file: string; env: string }>> = {
  claude: { file: 'claude-code', env: 'CLAUDE_CODE_OAUTH_TOKEN' },
  cursor: { file: 'cursor', env: 'CURSOR_API_KEY' },
};

const EXECUTABLE_HOST: Readonly<Record<string, ProviderCommandHost>> = {
  claude: 'claude',
  'cursor-agent': 'cursor',
};

export function providerTokenEnvName(host: ProviderCommandHost): string | undefined {
  return TOKEN_SLOTS[host]?.env;
}

export function providerTokenPath(host: ProviderCommandHost): string | undefined {
  const slot = TOKEN_SLOTS[host];
  return slot ? join(trustedMajorHome(), 'credentials', slot.file) : undefined;
}

/**
 * Pick the one token out of piped input. `claude setup-token` may print
 * guidance around the token, so a single `sk-ant-oat…` word wins for Claude;
 * otherwise the input must be exactly one whitespace-free word.
 */
export function parseProviderToken(host: ProviderCommandHost, input: string): string {
  if (host === 'claude') {
    // A real token is ~100 characters; a shorter match means the output was
    // wrapped or cut, and storing the fragment would fail later and silently.
    const matches = input.match(/\bsk-ant-oat[0-9]*-[A-Za-z0-9_-]{60,}/g) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('input contains more than one Claude token');
  }
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 1) throw new Error('expected exactly one token on stdin');
  const token = words[0]!;
  if (token.length < 16 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('stdin does not look like a provider token');
  }
  return token;
}

/** Atomically write the token with 0600 permissions under a 0700 directory. */
export function importProviderToken(host: ProviderCommandHost, input: string): string {
  const path = providerTokenPath(host);
  if (!path) throw new Error(`${host} has no supported headless token`);
  const token = parseProviderToken(host, input);
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeSync(fd, token);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return path;
}

/**
 * The stored token, or undefined. Refuses a symlink, a non-regular file, a
 * file owned by another user or one readable by group/other, so a planted
 * or loosened file is never injected.
 */
export function readProviderToken(host: ProviderCommandHost): string | undefined {
  const path = providerTokenPath(host);
  if (!path) return undefined;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined; // absent, or a symlink
  }
  try {
    // fstat on the opened descriptor: the checked file is the read file.
    const stats = fstatSync(fd);
    if (!stats.isFile() || (stats.mode & 0o077) !== 0) return undefined;
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) return undefined;
    return readFileSync(fd, 'utf8').trim() || undefined;
  } finally {
    closeSync(fd);
  }
}

/** Env to inject into one provider executable's processes; empty when none is stored. */
export function providerTokenEnv(executable: string): Record<string, string> {
  const host = EXECUTABLE_HOST[executable];
  const env = host ? providerTokenEnvName(host) : undefined;
  const token = host ? readProviderToken(host) : undefined;
  return env && token ? { [env]: token } : {};
}
