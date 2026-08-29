import { existsSync, statSync } from 'node:fs';
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
  /** Subset of allowedRoots that descendants may mutate. Defaults to all allowed roots. */
  writableRoots?: readonly string[];
  readOnlyRoots?: readonly string[];
  allowNetworkOutbound?: boolean;
  allowCredentialServices?: boolean;
  allowProcessSignals?: boolean;
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

function schemeString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function canonicalRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => canonicalize(root)))];
}

function fileRule(operation: string, path: string): string {
  return statSync(path).isDirectory()
    ? `(${operation} (subpath ${schemeString(path)}))`
    : `(${operation} (literal ${schemeString(path)}))`;
}

function existingCanonicalRoots(roots: readonly string[]): string[] {
  return canonicalRoots(roots.filter((root) => existsSync(root)));
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
  const writableRoots = canonicalRoots(request.writableRoots ?? request.allowedRoots);
  const readOnlyRoots = canonicalRoots(request.readOnlyRoots ?? []);
  const systemReadRoots = existingCanonicalRoots([
    '/Library/Apple/usr',
    '/Library/Developer/CommandLineTools',
    '/Applications/Xcode.app/Contents',
    '/private/var/db/timezone/zoneinfo',
  ]);
  const systemReadFiles = existingCanonicalRoots([
    '/etc/ssl/cert.pem',
    '/Library/Preferences/com.apple.dt.Xcode.plist',
  ]);
  const deniedDataRoots = [
    ...new Set(
      [
        '/Applications',
        '/Library',
        '/Network',
        '/System/Volumes/Data',
        '/Users',
        '/Volumes',
        '/etc',
        '/home',
        '/net',
        '/opt',
        '/private/etc',
        '/private/tmp',
        '/private/var',
        '/tmp',
        '/usr/local',
        '/var',
        homedir(),
        tmpdir(),
      ].flatMap((root) => {
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
    ...(request.allowProcessSignals === false ? [] : ['(allow signal)']),
    '(allow sysctl-read)',
    '(allow mach-lookup',
    ...(request.allowCredentialServices === false
      ? []
      : ['  (global-name "com.apple.SecurityServer")']),
    '  (global-name "com.apple.SystemConfiguration.configd")',
    '  (global-name "com.apple.cfprefsd.agent")',
    '  (global-name "com.apple.cfprefsd.daemon")',
    '  (global-name "com.apple.dnssd.service")',
    '  (global-name "com.apple.networkd")',
    '  (global-name "com.apple.nsurlsessiond")',
    ...(request.allowCredentialServices === false ? [] : ['  (global-name "com.apple.securityd")']),
    '  (global-name "com.apple.system.logger")',
    '  (global-name "com.apple.system.opendirectoryd.libinfo")',
    ...(request.allowCredentialServices === false
      ? [')']
      : ['  (global-name "com.apple.trustd.agent"))']),
    '(allow ipc-posix*)',
    // Signed binaries and the dynamic loader need broad system traversal.
    // Deny data under every mutable/sensitive top-level host location, then
    // reopen only the exact project, provider and minimal system runtime roots.
    '(allow file-read*)',
    ...deniedDataRoots.map((root) => `(deny file-read-data (subpath ${schemeString(root)}))`),
    ...systemReadRoots.map((root) => fileRule('allow file-read*', root)),
    ...systemReadRoots.map((root) => fileRule('allow file-read-data', root)),
    ...systemReadFiles.map((root) => fileRule('allow file-read*', root)),
    ...systemReadFiles.map((root) => fileRule('allow file-read-data', root)),
    ...roots.map((root) => `(allow file-read* (subpath ${schemeString(root)}))`),
    ...roots.map((root) => `(allow file-read-data (subpath ${schemeString(root)}))`),
    ...readOnlyRoots.map((root) => fileRule('allow file-read*', root)),
    ...readOnlyRoots.map((root) => fileRule('allow file-read-data', root)),
    ...exactExecutableRoots.map((path) => `(allow file-read* (literal ${schemeString(path)}))`),
    ...writableRoots.map((root) => `(allow file-write* (subpath ${schemeString(root)}))`),
    `(allow file-write* (literal ${schemeString('/dev/null')}))`,
    ...(request.allowNetworkOutbound === false ? [] : ['(allow network-outbound)']),
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
    processTreeTermination: ready,
    filesystemIsolation: containment.filesystemIsolation,
    networkIsolation: containment.networkIsolation,
    liveExecutionReady: ready,
    detail: containment.detail,
  };
}
