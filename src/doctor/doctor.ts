import { existsSync } from 'node:fs';
import { platform, release } from 'node:os';
import type { ProviderAdapter, ProviderInfo } from '../providers/types.js';
import { unavailableCapabilityStatuses, type CapabilityStatus } from '../security/capabilities.js';
import { detectContainment } from '../security/containment.js';
import { redactText } from '../security/redact.js';

export type CheckStatus = 'ok' | 'warn' | 'missing';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  required: boolean;
}

export interface DoctorReport {
  os: string;
  checks: DoctorCheck[];
  providers: ProviderInfo[];
  configuredProjects: { name: string; repoPath: string }[];
  missingPrerequisites: string[];
  overnightSafe: boolean;
  overnightSafeReasons: string[];
  /** True only when the OS containment required for live agent execution is
   * actually enforced. False in this foundation (no filesystem sandbox).
   * DIAGNOSTIC ONLY: enforcement is the hard-coded capability gate
   * (src/security/capabilities.ts), never this report or any flag. */
  liveExecutionReady: boolean;
  liveExecutionBlockers: string[];
  /** Capabilities unavailable in this build (hard-coded, not configurable). */
  capabilities: CapabilityStatus[];
}

export type CommandRunner = (executable: string, args: string[]) => string | undefined;

export interface DoctorInputs {
  providers: ProviderAdapter[];
  configuredProjects: { name: string; repoPath: string }[];
  /** Mandatory: doctor never spawns directly — the CLI supplies a
   * gateway-backed probe runner so every probe is policy-checked and
   * recorded. */
  run: CommandRunner;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
}

export async function runDoctor(inputs: DoctorInputs): Promise<DoctorReport> {
  const run = inputs.run;
  const env = inputs.env ?? process.env;
  const fileExists = inputs.fileExists ?? existsSync;
  const checks: DoctorCheck[] = [];

  const add = (name: string, required: boolean, value: string | undefined, missingDetail: string) =>
    checks.push({
      name,
      required,
      status: value ? 'ok' : required ? 'missing' : 'warn',
      detail: value ?? missingDetail,
    });

  add('node', true, process.version, 'Node.js not detected');
  add('pnpm', true, run('pnpm', ['--version']), 'pnpm not found on PATH');
  add('git', true, run('git', ['--version']), 'git not found on PATH');

  const ghVersion = run('gh', ['--version'])?.split('\n')[0];
  add('github-cli', false, ghVersion, 'GitHub CLI (gh) not found');
  if (ghVersion) {
    const authed = run('gh', ['auth', 'status']) !== undefined;
    checks.push({
      name: 'github-auth',
      required: false,
      status: authed ? 'ok' : 'warn',
      detail: authed ? 'gh authenticated' : 'gh installed but not authenticated',
    });
  }

  const providerInfos: ProviderInfo[] = [];
  for (const provider of inputs.providers) {
    const info = await provider.discover();
    providerInfos.push(info);
    checks.push({
      name: `provider:${info.name}`,
      required: false,
      status: info.installed ? (info.authenticated ? 'ok' : 'warn') : 'missing',
      detail: info.installed
        ? `${info.version ?? 'installed'}${info.authenticated ? '' : ' (auth not detected)'}`
        : 'executable not found',
    });
  }

  add('tmux', false, run('tmux', ['-V']), 'tmux not found (recommended for long sessions)');
  if (platform() === 'darwin') {
    add('caffeinate', false, run('which', ['caffeinate']), 'caffeinate not found');
  }

  let sqliteOk = false;
  try {
    const { default: Database } = await import('better-sqlite3');
    new Database(':memory:').close();
    sqliteOk = true;
  } catch {
    sqliteOk = false;
  }
  checks.push({
    name: 'sqlite',
    required: true,
    status: sqliteOk ? 'ok' : 'missing',
    detail: sqliteOk ? 'better-sqlite3 operational' : 'better-sqlite3 failed to load',
  });

  const credsVar = 'GOOGLE_APPLICATION_CREDENTIALS';
  const credsPath = env[credsVar];
  checks.push({
    name: 'google-credentials',
    required: false,
    status: credsPath && fileExists(credsPath) ? 'ok' : 'warn',
    detail: credsPath
      ? fileExists(credsPath)
        ? `${credsVar} set, file present (contents not read)`
        : `${credsVar} set but file missing`
      : `${credsVar} not set (roadmap sync unavailable)`,
  });

  // Descendant/process containment for live agent execution. Reported honestly:
  // process-tree termination is available on POSIX, but no OS filesystem
  // sandbox is wired, so live execution readiness is false.
  const containment = detectContainment();
  checks.push({
    name: 'descendant-containment',
    required: false,
    status: containment.liveExecutionReady ? 'ok' : 'warn',
    detail: containment.detail,
  });
  const liveExecutionBlockers: string[] = [];
  if (!containment.liveExecutionReady) {
    liveExecutionBlockers.push(`descendant containment insufficient: ${containment.detail}`);
  }

  const missingPrerequisites = checks
    .filter((c) => c.required && c.status === 'missing')
    .map((c) => c.name);

  const overnightSafeReasons: string[] = [];
  if (missingPrerequisites.length > 0) {
    overnightSafeReasons.push(`missing prerequisites: ${missingPrerequisites.join(', ')}`);
  }
  const usableProvider = providerInfos.some((p) => p.installed && p.authenticated);
  if (!usableProvider) {
    overnightSafeReasons.push('no installed+authenticated agent provider');
  }
  if (inputs.configuredProjects.length === 0) {
    overnightSafeReasons.push('no projects configured');
  }
  if (
    platform() === 'darwin' &&
    !checks.some((c) => c.name === 'caffeinate' && c.status === 'ok')
  ) {
    overnightSafeReasons.push('caffeinate unavailable: machine may sleep mid-run');
  }

  return {
    os: `${platform()} ${release()}`,
    checks: checks.map((c) => ({ ...c, detail: redactText(c.detail) })),
    providers: providerInfos,
    configuredProjects: inputs.configuredProjects,
    missingPrerequisites,
    overnightSafe: overnightSafeReasons.length === 0,
    overnightSafeReasons,
    liveExecutionReady: containment.liveExecutionReady,
    liveExecutionBlockers,
    capabilities: unavailableCapabilityStatuses(),
  };
}
