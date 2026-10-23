import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DoctorCheck } from './doctor.js';

/**
 * Read-only GBrain autopilot probe. GBrain is an optional, on-demand MCP by
 * owner policy, so a disabled or uninstalled autopilot is reported as info.
 * Set MAJOR_GBRAIN_MODE=autopilot to restore the warning for a self-disabled
 * autopilot. An enabled wrapper whose --repo path is gone always warns with the
 * owner's repair command. Major never edits ~/.gbrain itself.
 */
export function gbrainAutopilotCheck(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): DoctorCheck | undefined {
  const home = env.MAJOR_GBRAIN_HOME ?? join(homedir(), '.gbrain');
  const wrapper = join(home, 'autopilot-run.sh');
  const onDemand = env.MAJOR_GBRAIN_MODE !== 'autopilot';
  if (!fileExists(wrapper)) {
    return onDemand ? onDemandCheck('autopilot not installed') : undefined;
  }
  const marker = join(home, 'autopilot-disabled');
  const repo = /autopilot --repo '([^']+)'/.exec(safeRead(readFile, wrapper))?.[1];
  const problems: string[] = [];
  if (fileExists(marker)) {
    const reason = safeRead(readFile, marker).trim() || marker;
    if (onDemand) return onDemandCheck(`autopilot disabled: ${reason}`);
    problems.push(`autopilot disabled (${reason})`);
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

function onDemandCheck(state: string): DoctorCheck {
  return {
    name: 'gbrain-autopilot',
    required: false,
    status: 'info',
    detail: `GBrain on-demand mode (${state}); use the GBrain MCP only when explicitly asked or a named hand-written entity page is relevant`,
  };
}

function safeRead(readFile: (path: string) => string, path: string): string {
  try {
    return readFile(path);
  } catch {
    return '';
  }
}
