import { join } from 'node:path';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { routedExecutionContext } from './route-context.js';

const CONTROL_ENV = new Set(['MAJOR_DSH_GUEST_PROVIDER', 'MAJOR_DSH_GUEST_ARGV_JSON']);

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`major-lima-subprocess: ${label} is required`);
  }
  return value;
}

function majorExecutable() {
  if (process.env.MAJOR_BIN) return process.env.MAJOR_BIN;
  return join(required(process.env.HOME, 'HOME'), '.local', 'bin', 'major');
}

function guestArgv(value) {
  let parsed;
  try {
    parsed = JSON.parse(required(value, 'MAJOR_DSH_GUEST_ARGV_JSON'));
  } catch {
    throw new Error('major-lima-subprocess: MAJOR_DSH_GUEST_ARGV_JSON must be valid JSON');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error('major-lima-subprocess: guest argv must be a non-empty string array');
  }
  return parsed;
}

/**
 * DSH subprocess implementation scoped only to the Lima Codex adapter. It
 * preserves the upstream App Server adapter and redirects its one child into
 * Major's provider-independent Lima workspace bridge. The host subprocess
 * service remains local for Major CLI, UI, and review work.
 */
export class LimaSubprocessRuntime extends LocalSubprocessRuntime {
  spawn(spec) {
    const provider = required(spec.env?.MAJOR_DSH_GUEST_PROVIDER, 'guest provider');
    const argv = guestArgv(spec.env?.MAJOR_DSH_GUEST_ARGV_JSON);
    const route = routedExecutionContext();
    const goalId = required(route.goalId, 'routed goal id');
    const accountLabel = required(route.accountLabel, 'routed account label');
    const leaseId = required(route.leaseId, 'worker lease id');
    const leasePid = required(route.leasePid, 'worker lease pid');
    const env = Object.fromEntries(
      Object.entries(spec.env ?? {}).filter(([name]) => !CONTROL_ENV.has(name)),
    );
    return super.spawn({
      ...spec,
      argv: [
        majorExecutable(),
        'harness',
        'environment-subprocess',
        '--environment',
        'lima',
        '--provider',
        provider,
        '--goal-id',
        goalId,
        '--account-label',
        accountLabel,
        '--resource-lease-id',
        leaseId,
        '--resource-lease-pid',
        leasePid,
        '--cwd',
        spec.cwd,
        '--guest-argv-json',
        JSON.stringify(argv),
      ],
      env,
    });
  }

  async spawnTerminal() {
    throw new Error(
      'major-lima-subprocess: terminal processes are not part of the native adapter seam',
    );
  }
}

export default LimaSubprocessRuntime;
