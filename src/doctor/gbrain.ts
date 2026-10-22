import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheck } from './doctor.js';

/**
 * Read-only GBrain autopilot probe. It flags a self-disabled autopilot or a
 * wrapper whose --repo path is gone, and prints the owner's repair command.
 * Major never edits ~/.gbrain itself.
 */
export function gbrainAutopilotCheck(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DoctorCheck | undefined {
  const home = env.MAJOR_GBRAIN_HOME ?? join(homedir(), '.gbrain');
  const wrapper = join(home, 'autopilot-run.sh');
  if (!fileExists(wrapper)) return undefined; // Autopilot was never installed.
  const marker = join(home, 'autopilot-disabled');
  const repo = /autopilot --repo '([^']+)'/.exec(safeRead(readFile, wrapper))?.[1];
  const problems: string[] = [];
  if (fileExists(marker)) {
    problems.push(`autopilot disabled (${safeRead(readFile, marker).trim() || marker})`);
  }
  if (repo && !fileExists(repo)) problems.push(`autopilot repo path missing: ${repo}`);
  if (problems.length === 0) {
    return {
      name: 'gbrain-autopilot',
      required: false,
      status: 'ok',
      detail: `autopilot enabled${repo ? ` for ${repo}` : ''}`,
    };
  }
  return {
    name: 'gbrain-autopilot',
    required: false,
    status: 'warn',
    detail:
      `${problems.join('; ')}. Owner action: gbrain autopilot --install --repo <existing-brain-repo> ` +
      '(reinstall rewrites the wrapper and clears the disabled marker; Major does not edit ~/.gbrain)',
  };
}

function safeRead(readFile: (path: string) => string, path: string): string {
  try {
    return readFile(path);
  } catch {
    return '';
  }
}
