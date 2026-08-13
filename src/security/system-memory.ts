import { execFileSync } from 'node:child_process';

/** Fixed, read-only macOS probe used by the global admission guard. */
export function readSystemMemoryAvailablePercent(): number | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const output = execFileSync('/usr/bin/memory_pressure', ['-Q'], {
      encoding: 'utf8',
      timeout: 2_000,
      env: {},
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = output.match(/System-wide memory free percentage:\s*(\d+)%/);
    return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}
