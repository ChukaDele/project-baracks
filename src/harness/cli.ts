import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { LimaBackend } from '../execution/lima-backend.js';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import type { ProviderCommandHost } from '../providers/commands.js';
import { assertExecutionAllowed, getProjectPolicy } from '../supervisor/policy.js';
import { getGoal } from '../supervisor/state.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  bundleManifest,
  majorKernelBundle,
  profileManifest,
  workstationProfiles,
} from './composition.js';
import {
  conformancePassed,
  formatHarnessConformance,
  runHarnessConformance,
} from './conformance.js';
import { buildHarnessInstallPlan, formatHarnessInstallPlan } from './install-plan.js';
import { DEEPSEEK_HARNESS_PIN } from './pin.js';
import { buildHarnessShadowTask, formatHarnessShadowTask } from './shadow-task.js';
import { buildWorkstationAppPlan, formatWorkstationAppPlan } from './workstation-app.js';

const HARNESS_HELP = `major harness — DeepSeek Harness distribution (shadow strangler)

  harness status [--json]
  harness compose [--json]
  harness conformance [--json]
  harness install-plan [--json]
  harness shadow-task [--json]
  harness workstation-app [--json]
`;

function repoRootFromCwd(): string {
  return resolve(process.env.MAJOR_HARNESS_ROOT ?? process.cwd());
}

function requiredFlag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`);
  return value;
}

export async function runHarnessCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'harness') return false;
  const command = args[1];
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HARNESS_HELP);
    return true;
  }
  const json = args.includes('--json');
  if (command === 'environment-subprocess') {
    if (requiredFlag(args, '--environment') !== 'lima') {
      throw new Error('only the Lima native execution environment is available');
    }
    const goalId = requiredFlag(args, '--goal-id');
    const goal = getGoal(goalId);
    if (!goal) throw new Error(`unknown goal: ${goalId}`);
    const cwd = realpathSync(resolve(requiredFlag(args, '--cwd')));
    if (realpathSync(goal.repoPath) !== cwd) {
      throw new Error('native execution environment goal does not match the requested workspace');
    }
    assertExecutionAllowed(getProjectPolicy(goal.project, goal.repoPath));
    const provider = requiredFlag(args, '--provider') as ProviderCommandHost;
    const accountLabel = requiredFlag(args, '--account-label');
    if (
      goal.lastRoutingDecision?.host !== provider ||
      goal.lastRoutingDecision.accountLabel !== accountLabel
    ) {
      throw new Error('native execution environment does not match Major routing authority');
    }
    const resourceLeasePid = Number.parseInt(requiredFlag(args, '--resource-lease-pid'), 10);
    if (!Number.isInteger(resourceLeasePid) || resourceLeasePid <= 0) {
      throw new Error('--resource-lease-pid must be a positive integer');
    }
    const guestArgv = JSON.parse(requiredFlag(args, '--guest-argv-json')) as unknown;
    if (
      !Array.isArray(guestArgv) ||
      guestArgv.some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      throw new Error('--guest-argv-json must be a string array');
    }
    const abort = new AbortController();
    const stop = () => abort.abort(new Error('native execution environment was asked to stop'));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const backend = new LimaBackend(loadLimaExecutionConfig());
      await backend.runNativeEnvironmentSubprocess({
        cwd,
        provider,
        accountLabel,
        goalId,
        guestArgv,
        resourceLeaseId: requiredFlag(args, '--resource-lease-id'),
        resourceLeasePid,
        signal: abort.signal,
        input: process.stdin,
        output: process.stdout,
        error: process.stderr,
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return true;
  }
  if (command === 'status') {
    const payload = {
      phase: CURRENT_HARNESS_MIGRATION_PHASE,
      executionBackend: DEFAULT_EXECUTION_BACKEND,
      pin: DEEPSEEK_HARNESS_PIN,
      liveDshInstalled: false,
      ready: false,
    };
    console.log(json ? JSON.stringify(payload, null, 2) : formatStatus());
    return true;
  }
  if (command === 'compose') {
    const payload = {
      pinVersion: DEEPSEEK_HARNESS_PIN.npm.version,
      kernel: {
        ...majorKernelBundle(),
        manifest: bundleManifest(majorKernelBundle()),
      },
      profiles: workstationProfiles().map((profile) => ({
        ...profile,
        manifest: profileManifest(profile),
      })),
    };
    console.log(json ? JSON.stringify(payload, null, 2) : formatCompose());
    return true;
  }
  if (command === 'conformance') {
    const report = runHarnessConformance(repoRootFromCwd());
    console.log(json ? JSON.stringify(report, null, 2) : formatHarnessConformance(report));
    if (!conformancePassed(report)) {
      throw new Error('DeepSeek Harness distribution conformance failed');
    }
    return true;
  }
  if (command === 'install-plan') {
    const plan = buildHarnessInstallPlan(repoRootFromCwd());
    console.log(json ? JSON.stringify(plan, null, 2) : formatHarnessInstallPlan(plan));
    return true;
  }
  if (command === 'shadow-task') {
    const task = buildHarnessShadowTask();
    console.log(json ? JSON.stringify(task, null, 2) : formatHarnessShadowTask(task));
    return true;
  }
  if (command === 'workstation-app') {
    const plan = buildWorkstationAppPlan();
    console.log(json ? JSON.stringify(plan, null, 2) : formatWorkstationAppPlan(plan));
    return true;
  }
  throw new Error(`unknown harness command: ${command}`);
}

function formatStatus(): string {
  return [
    `phase: ${CURRENT_HARNESS_MIGRATION_PHASE}`,
    `pin: ${DEEPSEEK_HARNESS_PIN.npm.version} (${DEEPSEEK_HARNESS_PIN.git.declaredTag})`,
    `attested commit: ${DEEPSEEK_HARNESS_PIN.git.attestedCommit ?? 'none'}`,
    `live execution backend: ${DEFAULT_EXECUTION_BACKEND}`,
    'live dsh installed: false',
    'ready: false',
  ].join('\n');
}

function formatCompose(): string {
  const [web, headless] = workstationProfiles();
  return [
    `kernel ${majorKernelBundle().name}: /major command with Major and Claude trajectory providers`,
    `web ${web.id}: ${web.bundles.join(' -> ')}`,
    `headless ${headless.id}: ${headless.bundles.join(' -> ')}`,
    `default backend: ${DEFAULT_EXECUTION_BACKEND}`,
  ].join('\n');
}
