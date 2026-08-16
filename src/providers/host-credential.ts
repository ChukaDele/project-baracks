import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { ProviderCommandHost } from './commands.js';

/**
 * Where each provider's CLI stores its own login on a normal host machine,
 * for the ONE safe onboarding operation this module supports: reusing a
 * login the user already has. This is deliberately narrow — one exact known
 * path per provider, never a directory walk or arbitrary file picker — and
 * every check below inspects metadata/shape only. No function in this file
 * ever logs, prints, or returns the file's actual secret content.
 *
 * Antigravity is intentionally absent: no host-side flat-file location for
 * its login could be confirmed on this platform (its guest-side credential,
 * `.gemini/antigravity-cli/antigravity-oauth-token`, has no verified host
 * counterpart). Reporting "unknown" here is safer than guessing a path that
 * might silently import the wrong file.
 */
const HOST_CREDENTIAL_PATHS: Partial<Record<ProviderCommandHost, string>> = {
  claude: join(homedir(), '.claude', '.credentials.json'),
  codex: join(homedir(), '.codex', 'auth.json'),
  cursor: join(homedir(), '.config', 'cursor', 'auth.json'),
};

export type HostCredentialCheck =
  | { status: 'found'; path: string; detail: string }
  | { status: 'not-found'; detail: string }
  | { status: 'unsafe'; detail: string };

/** True only if a macOS Keychain entry for Claude Code exists. Uses
 * `security find-generic-password` WITHOUT `-w`: this confirms presence via
 * exit code only and never reads or prints the stored secret. */
function hasClaudeKeychainEntry(): boolean {
  if (platform() !== 'darwin') return false;
  try {
    execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Metadata-only host credential check: existence, regular file, not a
 * symlink, single hard link, and (for the JSON-shaped formats used here)
 * that it parses as a non-empty JSON object — never inspecting or returning
 * any key's value. Cross-provider confusion is impossible by construction:
 * the caller always supplies the host they're checking, and the path table
 * has exactly one entry per host.
 */
export function checkHostCredential(host: ProviderCommandHost): HostCredentialCheck {
  const path = HOST_CREDENTIAL_PATHS[host];
  if (!path) {
    if (host === 'claude' && hasClaudeKeychainEntry()) {
      return {
        status: 'unsafe',
        detail:
          'Claude Code is authenticated on this Mac via the macOS Keychain, not a flat file. ' +
          'Major cannot safely extract a Keychain secret without reading its content, which is ' +
          'not permitted for this operation — sign in with Claude directly inside the isolated ' +
          'worker instead, or see docs/readiness-model.md for a manual export procedure.',
      };
    }
    return {
      status: 'not-found',
      detail: `no known host credential location for ${host} on this platform`,
    };
  }
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return { status: 'not-found', detail: `no credential file at ${path}` };
  }
  if (stats.isSymbolicLink()) {
    return {
      status: 'unsafe',
      detail: `${path} is a symlink; refusing to import a symlinked credential`,
    };
  }
  if (!stats.isFile()) {
    return { status: 'unsafe', detail: `${path} is not a regular file` };
  }
  if (stats.nlink !== 1) {
    return { status: 'unsafe', detail: `${path} has more than one hard link; refusing to import` };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length === 0) {
      return { status: 'unsafe', detail: `${path} does not look like a provider credential file` };
    }
  } catch {
    return { status: 'unsafe', detail: `${path} is not valid JSON` };
  }
  return { status: 'found', path, detail: `found at ${path}` };
}

/** A one-way, non-reversible fingerprint of the credential's current bytes —
 * never the bytes themselves. Used only to detect "this changed since we
 * last imported it" (the manual account-swap signal), never persisted or
 * logged as anything but this digest. */
export function fingerprintCredentialFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
