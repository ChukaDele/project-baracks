import { constants, accessSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { LimaBackend } from '../execution/lima-backend.js';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import type { ProviderCommandHost } from '../providers/commands.js';
import { assertExecutionAllowed, getProjectPolicy } from '../supervisor/policy.js';
import { getGoal } from '../supervisor/state.js';
import { resolveSupervisedWorkshopAuthority } from '../security/supervised-workshop.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  DEFAULT_EXECUTION_ENVIRONMENT,
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
import { buildWorkstationAppPlan, formatWorkstationAppPlan } from './workstation-app.js';

const HARNESS_HELP = `major harness — DeepSeek Harness live workstation

  harness status [--json]
  harness compose [--json]
  harness conformance [--json]
  harness install-plan [--json]
  harness workstation-app [--json]
`;

function repoRootFromCwd(): string {
  return resolve(process.env.MAJOR_HARNESS_ROOT ?? process.cwd());
}

export interface LiveDshStatus {
  liveDshInstalled: boolean;
  ready: boolean;
}

function isExecutableRegularFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isCompleteProfile(dshHome: string, profile: string): boolean {
  try {
    const profileDirectory = join(dshHome, 'profiles', profile);
    return (
      statSync(profileDirectory).isDirectory() &&
      ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'].every((file) =>
        statSync(join(profileDirectory, file)).isFile(),
      )
    );
  } catch {
    return false;
  }
}

export function liveDshStatus(env: NodeJS.ProcessEnv = process.env): LiveDshStatus {
  const majorHome = env.MAJOR_HOME ?? join(homedir(), '.major');
  const dshHome = env.MAJOR_DSH_HOME ?? join(majorHome, 'dsh-harness');
  try {
    const record = JSON.parse(readFileSync(join(dshHome, 'major-install.json'), 'utf8')) as {
      schemaVersion?: number;
      pinVersion?: string;
      attestedCommit?: string;
      dshHome?: string;
      phase?: string;
      defaultRuntime?: string;
    };
    const liveDshInstalled =
      record.schemaVersion === 1 &&
      record.pinVersion === DEEPSEEK_HARNESS_PIN.npm.version &&
      record.attestedCommit === DEEPSEEK_HARNESS_PIN.git.attestedCommit &&
      record.dshHome === dshHome &&
      record.phase === CURRENT_HARNESS_MIGRATION_PHASE &&
      record.defaultRuntime === 'dsh-local';
    const dshExecutable = join(dshHome, 'runtime', 'node_modules', '.bin', 'dsh');
    const ready =
      liveDshInstalled &&
      isExecutableRegularFile(dshExecutable) &&
      isCompleteProfile(dshHome, 'major-workstation-web') &&
      isCompleteProfile(dshHome, 'major-workstation-headless');
    return { liveDshInstalled, ready };
  } catch {
    return { liveDshInstalled: false, ready: false };
  }
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
    const executionAuthority = resolveSupervisedWorkshopAuthority(cwd);
    const provider = requiredFlag(args, '--provider') as ProviderCommandHost;
    const accountLabel = requiredFlag(args, '--account-label');
    if (
      goal.lastRoutingDecision?.host !== provider ||
      goal.lastRoutingDecision.accountLabel !== accountLabel
    ) {
      throw new Error('native execution environment does not match Major routing authority');
    }
    const resourceLeasePidRaw = requiredFlag(args, '--resource-lease-pid');
    if (!/^[1-9]\d*$/.test(resourceLeasePidRaw)) {
      throw new Error('--resource-lease-pid must be a positive integer');
    }
    const resourceLeasePid = Number(resourceLeasePidRaw);
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
        executionAuthority,
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
    const status = liveDshStatus();
    const payload = {
      phase: CURRENT_HARNESS_MIGRATION_PHASE,
      executionBackend: DEFAULT_EXECUTION_BACKEND,
      defaultEnvironment: DEFAULT_EXECUTION_ENVIRONMENT,
      pin: DEEPSEEK_HARNESS_PIN,
      ...status,
    };
    console.log(json ? JSON.stringify(payload, null, 2) : formatStatus(status));
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
  if (command === 'workstation-app') {
    const plan = buildWorkstationAppPlan();
    console.log(json ? JSON.stringify(plan, null, 2) : formatWorkstationAppPlan(plan));
    return true;
  }
  throw new Error(`unknown harness command: ${command}`);
}

function formatStatus(status: LiveDshStatus): string {
  return [
    `phase: ${CURRENT_HARNESS_MIGRATION_PHASE}`,
    `pin: ${DEEPSEEK_HARNESS_PIN.npm.version} (${DEEPSEEK_HARNESS_PIN.git.declaredTag})`,
    `attested commit: ${DEEPSEEK_HARNESS_PIN.git.attestedCommit ?? 'none'}`,
    `live execution backend: ${DEFAULT_EXECUTION_BACKEND}`,
    `default execution environment: ${DEFAULT_EXECUTION_ENVIRONMENT}`,
    `live dsh installed: ${status.liveDshInstalled}`,
    `ready: ${status.ready}`,
  ].join('\n');
}

function formatCompose(): string {
  const [web, headless] = workstationProfiles();
  return [
    `kernel ${majorKernelBundle().name}: /major command with Major and Claude trajectory providers`,
    `web ${web.id}: ${web.bundles.join(' -> ')}`,
    `headless ${headless.id}: ${headless.bundles.join(' -> ')}`,
    `default backend: ${DEFAULT_EXECUTION_BACKEND}`,
    `default environment: ${DEFAULT_EXECUTION_ENVIRONMENT}`,
  ].join('\n');
}
