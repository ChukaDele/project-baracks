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
 *
 * Computed lazily (not a frozen module-level object) so `homedir()` is read
 * fresh on every call — this process's HOME doesn't change in production,
 * but a frozen computation made this untestable in-process and is a latent
 * footgun for any future caller that does change it dynamically.
 */
function hostCredentialPath(host: ProviderCommandHost): string | undefined {
  switch (host) {
    case 'claude':
      return join(homedir(), '.claude', '.credentials.json');
    case 'codex':
      return join(homedir(), '.codex', 'auth.json');
    case 'cursor':
      return join(homedir(), '.config', 'cursor', 'auth.json');
    default:
      return undefined;
  }
}

/**
 * Some providers store their real login in the macOS Keychain instead of (or
 * as well as) a flat file — confirmed for Claude Code (`Claude Code-credentials`)
 * and, on this platform, for the Cursor CLI (`cursor-access-token`, verified
 * against a real `cursor-agent`-authenticated machine where the assumed flat
 * file at ~/.config/cursor/auth.json does not exist at all). This is checked
 * as a FALLBACK whenever the flat-file path is absent, never instead of it —
 * some installations (e.g. Linux, where Keychain doesn't exist) still use the
 * flat file.
 */
function keychainServiceName(host: ProviderCommandHost): string | undefined {
  switch (host) {
    case 'claude':
      return 'Claude Code-credentials';
    case 'cursor':
      return 'cursor-access-token';
    default:
      return undefined;
  }
}

function providerLabel(host: ProviderCommandHost): string {
  switch (host) {
    case 'claude':
      return 'Claude Code';
    case 'cursor':
      return 'Cursor';
    default:
      return host;
  }
}

export type HostCredentialCheck =
  | { status: 'found'; path: string; detail: string }
  | { status: 'not-found'; detail: string }
  | { status: 'unsafe'; detail: string };

/** True only if a macOS Keychain entry for the given service exists. Uses
 * `security find-generic-password` WITHOUT `-w`: this confirms presence via
 * exit code only and never reads or prints the stored secret. */
function hasKeychainEntry(service: string): boolean {
  if (platform() !== 'darwin') return false;
  try {
    execFileSync('/usr/bin/security', ['find-generic-password', '-s', service], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function keychainFallback(host: ProviderCommandHost): HostCredentialCheck | undefined {
  const service = keychainServiceName(host);
  if (!service || !hasKeychainEntry(service)) return undefined;
  return {
    status: 'unsafe',
    detail:
      `${providerLabel(host)} is authenticated on this Mac via the macOS Keychain, not a flat ` +
      'file. Major cannot safely extract a Keychain secret without reading its content, which is ' +
      'not permitted for this operation — sign in with it directly inside the isolated worker ' +
      'instead, or see docs/readiness-model.md for a manual export procedure.',
  };
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
  const path = hostCredentialPath(host);
  if (!path) {
    return (
      keychainFallback(host) ?? {
        status: 'not-found',
        detail: `no known host credential location for ${host} on this platform`,
      }
    );
  }
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    return (
      keychainFallback(host) ?? { status: 'not-found', detail: `no credential file at ${path}` }
    );
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
