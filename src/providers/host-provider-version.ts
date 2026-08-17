import { execFileSync } from 'node:child_process';

/**
 * Runs an ALREADY-RESOLVED, trusted provider executable with `--version` and
 * extracts a semver-shaped string from its output. This is the one place
 * outside the gateway that spawns a host provider binary — deliberately
 * narrow: no shell, no other args, a short timeout, and the caller must
 * supply an absolute path it already trusts (e.g. via
 * ExecutionGateway.resolveExecutable), never a bare name resolved here.
 *
 * Read-only and side-effect-free by convention of every provider CLI's own
 * `--version` flag; this never runs the provider's actual agent/login work.
 * Returns undefined if the binary can't be run or prints nothing
 * version-shaped, rather than throwing — version compatibility is a
 * diagnostic, not a hard requirement.
 */
export function hostProviderVersion(resolvedExecutablePath: string): string | undefined {
  if (!resolvedExecutablePath.startsWith('/')) return undefined;
  let output: string;
  try {
    output = execFileSync(resolvedExecutablePath, ['--version'], {
      timeout: 5_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const e = error as { stdout?: string };
    output = e.stdout ?? '';
  }
  const match = output.match(/\d+\.\d+\.\d+/);
  return match?.[0];
}
