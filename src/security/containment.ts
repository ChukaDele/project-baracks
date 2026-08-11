import { existsSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { canonicalize } from './paths.js';
import { TrustedExecutableRegistry } from './trusted-executables.js';

export interface ContainmentCommand {
  executable: string;
  args: string[];
}

export interface ContainmentRequest {
  executable: string;
  canonicalExecutable: string;
  args: readonly string[];
  allowedRoots: readonly string[];
}

/** An executable OS boundary, not a descriptive readiness flag. */
export interface Containment {
  readonly enforced: boolean;
  readonly filesystemIsolation: boolean;
  readonly networkIsolation: boolean;
  readonly mechanism: string;
  readonly detail: string;
  wrap(request: ContainmentRequest): ContainmentCommand;
}

function unavailableContainment(os: string): Containment {
  return {
    enforced: false,
    filesystemIsolation: false,
    networkIsolation: false,
    mechanism: 'unsupported',
    detail: `trusted OS isolation is unavailable on ${os}`,
    wrap() {
      throw new Error(`trusted OS isolation is unavailable on ${os}`);
    },
  };
}

/** Process-group termination only. This is never sufficient for live execution. */
export function processTreeContainment(os: string = platform()): Containment {
  const posix = os !== 'win32';
  return {
    enforced: posix,
    filesystemIsolation: false,
    networkIsolation: false,
    mechanism: posix ? 'posix-process-group' : 'unsupported',
    detail: posix
      ? 'descendants share a process group; filesystem and network access are not isolated'
      : `process-group containment is unavailable on ${os}`,
    wrap(request) {
      return { executable: request.executable, args: [...request.args] };
    },
  };
}

function schemeString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function canonicalRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => canonicalize(root)))];
}

/**
 * Build a macOS Seatbelt boundary for a single spawn.
 *
 * System files remain readable so signed provider binaries and the dynamic
 * loader can start. User and temporary data are denied, then only the exact
 * project/runtime roots are reopened. Writes are denied everywhere except
 * those same roots. Network access is outbound-only.
 */
function seatbeltProfile(request: ContainmentRequest): string {
  const roots = canonicalRoots(request.allowedRoots);
  const deniedDataRoots = [
    ...new Set(
      ['/Users', '/Volumes', homedir(), '/private/tmp', '/tmp', tmpdir()].flatMap((root) => {
        try {
          return [root, canonicalize(root)];
        } catch {
          return [root];
        }
      }),
    ),
  ];
  const exactExecutableRoots = [request.executable, request.canonicalExecutable].map((path) =>
    canonicalize(path),
  );
  const forms = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix*)',
    '(allow file-read*)',
    ...deniedDataRoots.map((root) => `(deny file-read-data (subpath ${schemeString(root)}))`),
    ...roots.map((root) => `(allow file-read* (subpath ${schemeString(root)}))`),
    ...exactExecutableRoots.map((path) => `(allow file-read* (literal ${schemeString(path)}))`),
    ...roots.map((root) => `(allow file-write* (subpath ${schemeString(root)}))`),
    '(allow network-outbound)',
  ];
  return forms.join(' ');
}

/**
 * macOS trusted execution boundary. The sandbox executable is pinned at
 * construction and content-rehashed immediately before every wrapped spawn.
 */
export function darwinSeatbeltContainment(
  os: string = platform(),
  sandboxPath = '/usr/bin/sandbox-exec',
): Containment {
  if (os !== 'darwin' || !existsSync(sandboxPath)) return unavailableContainment(os);

  const registry = new TrustedExecutableRegistry();
  const trustedSandbox = registry.pin(sandboxPath);
  return {
    enforced: true,
    filesystemIsolation: true,
    networkIsolation: true,
    mechanism: 'macos-seatbelt-outbound-only',
    detail:
      'macOS Seatbelt confines descendant reads and writes to explicit data roots; network is outbound-only',
    wrap(request) {
      const sandbox = registry.verify(trustedSandbox.name);
      return {
        executable: sandbox.spawnPath,
        args: ['-p', seatbeltProfile(request), request.executable, ...request.args],
      };
    },
  };
}

export interface ContainmentStatus {
  processTreeTermination: boolean;
  filesystemIsolation: boolean;
  networkIsolation: boolean;
  liveExecutionReady: boolean;
  detail: string;
}

/** Report the containment the current platform can actually apply. */
export function detectContainment(os: string = platform()): ContainmentStatus {
  const containment = darwinSeatbeltContainment(os);
  const ready =
    containment.enforced && containment.filesystemIsolation && containment.networkIsolation;
  return {
    processTreeTermination: os !== 'win32',
    filesystemIsolation: containment.filesystemIsolation,
    networkIsolation: containment.networkIsolation,
    liveExecutionReady: ready,
    detail: containment.detail,
  };
}
