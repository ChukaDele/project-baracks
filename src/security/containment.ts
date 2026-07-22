import { platform } from 'node:os';

/**
 * Process containment for spawned agent processes.
 *
 * HONEST SCOPE: the only OS mechanism this foundation actually applies is
 * POSIX process-group containment — every spawn is a process-group leader, so
 * the COMPLETE descendant tree (not just Major's direct child) is signalled
 * and terminated together. That guarantees lifetime/termination containment of
 * the whole tree. It is NOT an OS filesystem or network sandbox: descendant
 * processes are not kernel-jailed to the allowed roots. Filesystem isolation
 * would require an external sandbox (e.g. sandbox-exec / bubblewrap /
 * namespaces) which is not wired here — so live agent execution stays disabled
 * until such containment is proven available (see doctor.liveExecutionReady).
 */
export interface Containment {
  /** True when the mechanism is actually applied to every spawn. */
  readonly enforced: boolean;
  /** Whether the OS confines descendants to the allowed filesystem roots.
   * Always false in this foundation: no kernel sandbox is applied. */
  readonly filesystemIsolation: boolean;
  readonly mechanism: string;
  readonly detail: string;
}

/**
 * Whole-process-tree termination containment. Applied by spawning each child
 * as a process-group leader and terminating the entire group on cancel/timeout
 * (see providers/exec.ts). Does not provide filesystem/network isolation.
 */
export function processTreeContainment(os: string = platform()): Containment {
  const posix = os !== 'win32';
  return {
    enforced: posix,
    filesystemIsolation: false,
    mechanism: posix ? 'posix-process-group' : 'unsupported',
    detail: posix
      ? 'spawned as a process-group leader; the entire descendant tree is terminated together. ' +
        'No OS filesystem/network isolation is applied.'
      : `process-group containment is unavailable on ${os}`,
  };
}

export interface ContainmentStatus {
  /** The whole descendant tree can be terminated together. */
  processTreeTermination: boolean;
  /** The OS confines descendants to the allowed roots. */
  filesystemIsolation: boolean;
  /**
   * True only when the containment required for live agent execution is
   * available AND enforced. This foundation ships no filesystem sandbox, so it
   * is false and live agent execution stays disabled.
   */
  liveExecutionReady: boolean;
  detail: string;
}

/** Report the containment the current platform can actually provide. */
export function detectContainment(os: string = platform()): ContainmentStatus {
  const c = processTreeContainment(os);
  return {
    processTreeTermination: c.enforced,
    filesystemIsolation: c.filesystemIsolation,
    liveExecutionReady: c.enforced && c.filesystemIsolation,
    detail:
      `${c.detail} OS-level descendant filesystem containment is not implemented, ` +
      'so live agent execution remains disabled.',
  };
}
