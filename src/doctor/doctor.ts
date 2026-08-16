import { existsSync } from 'node:fs';
import { platform, release } from 'node:os';
import type { ProviderAdapter, ProviderInfo } from '../providers/types.js';
import {
  capabilityStatuses,
  isCapabilityAvailable,
  type CapabilityStatus,
} from '../security/capabilities.js';
import { detectContainment, type ContainmentStatus } from '../security/containment.js';
import { redactText } from '../security/redact.js';
import type { BackendStatus } from '../execution/backend.js';
import {
  computeCoreReadiness,
  computeLiveExecutionReadiness,
  computeMultiProviderReadiness,
  computeProviderReadiness,
  type CoreReadiness,
  type LiveExecutionReadiness,
  type MultiProviderReadiness,
  type ProviderReadiness,
} from './readiness.js';

export type CheckStatus = 'ok' | 'warn' | 'missing';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  required: boolean;
}

/** Overnight execution remains unavailable without separate unattended authority. */
export type OvernightExecutionStatus = 'unavailable';

export interface DoctorReport {
  os: string;
  checks: DoctorCheck[];
  providers: ProviderInfo[];
  configuredProjects: { name: string; repoPath: string }[];
  missingPrerequisites: string[];
  /** Foreground capability activation does not grant unattended execution. */
  overnightExecution: OvernightExecutionStatus;
  overnightExecutionReasons: string[];
  /** Separate signal for inspection prerequisites. */
  inspectionEnvironmentOk: boolean;
  inspectionEnvironmentIssues: string[];
  /** Diagnostic only. Enforcement remains the immutable capability gate plus
   * the execution gateway; no caller may authorize work from this report. */
  liveExecutionReady: boolean;
  liveExecutionBlockers: string[];
  /** Immutable build capability status (hard-coded, not configurable). */
  capabilities: CapabilityStatus[];
  /** Core platform safety: isolated runner containment + required prerequisites.
   * Independent of any single provider's auth/billing state. */
  core: CoreReadiness;
  /** Per-provider actionable status. One provider's failure never changes
   * another provider's entry. */
  providerReadiness: ProviderReadiness[];
  /** liveExecutionReady restated with the providers that make it true and how
   * much fallback capacity exists. */
  liveExecution: LiveExecutionReadiness;
  multiProviderReady: boolean;
  multiProvider: MultiProviderReadiness;
}

/**
 * Resolve an executable name to a path for REPORTING ONLY. Process-free: the
 * CLI supplies a gateway-backed resolver (src/security/gateway.ts
 * resolveExecutable) that performs a PATH lookup and never runs anything.
 * Returns a resolved path (presence signal), or undefined when not found.
 */
export type ExecutableResolver = (name: string) => string | undefined;

export interface DoctorInputs {
  providers: ProviderAdapter[];
  configuredProjects: { name: string; repoPath: string }[];
  /** Mandatory: doctor never spawns — it only resolves names on PATH. */
  resolve: ExecutableResolver;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  /** Injectable only for deterministic doctor tests; production uses the real OS detector. */
  detectContainment?: () => ContainmentStatus;
  inspectExecutionBackend?: () => Promise<BackendStatus>;
}

export async function runDoctor(inputs: DoctorInputs): Promise<DoctorReport> {
  // Resolution-only: presence on PATH, never a subprocess. Detail reports the
  // resolved path (a presence signal), which — like all discovery in this
  // build — is unverified: the binary is never executed to confirm it runs.
  const resolve = inputs.resolve;
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

  // Node is the running interpreter: process.version is in-process, not a spawn.
  add('node', true, process.version, 'Node.js not detected');
  add('pnpm', true, resolve('pnpm'), 'pnpm not found on PATH');
  add('git', true, resolve('git'), 'git not found on PATH');
  add('github-cli', false, resolve('gh'), 'GitHub CLI (gh) not found');

  const providerInfos: ProviderInfo[] = [];
  for (const provider of inputs.providers) {
    const info = await provider.discover();
    providerInfos.push(info);
    const unverified = info.executableUnverified === true;
    checks.push({
      name: `provider:${info.name}`,
      required: false,
      status: info.installed
        ? info.authenticated
          ? 'ok'
          : 'warn'
        : unverified
          ? 'warn'
          : 'missing',
      detail: info.installed
        ? `${info.version ?? 'installed'}${info.authenticated ? '' : ' (auth not detected)'}`
        : unverified
          ? `${info.executable ? `resolved at ${info.executable}` : 'not found on PATH'}; ` +
            'UNVERIFIED — resolution-only discovery does not execute the provider; use the ' +
            'contained provider lifecycle probe for installation/version/auth evidence'
          : 'executable not found',
    });
  }

  add('tmux', false, resolve('tmux'), 'tmux not found (recommended for long sessions)');
  if (platform() === 'darwin') {
    add('caffeinate', false, resolve('caffeinate'), 'caffeinate not found');
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

  // Descendant/process containment and the immutable M1 activation gate are
  // reported separately.
  const liveExecutionCapabilityAvailable = isCapabilityAvailable('live-agent-execution');
  const backendStatus =
    liveExecutionCapabilityAvailable && inputs.inspectExecutionBackend
      ? await inputs.inspectExecutionBackend()
      : undefined;
  const containment = backendStatus
    ? {
        platform: 'lima',
        available: backendStatus.available,
        enforced: backendStatus.available,
        filesystemIsolation: backendStatus.filesystemIsolation,
        networkIsolation: backendStatus.networkIsolation,
        liveExecutionReady:
          backendStatus.available &&
          backendStatus.filesystemIsolation &&
          backendStatus.networkIsolation &&
          backendStatus.lifecycleIsolation,
        detail: backendStatus.detail,
      }
    : (inputs.detectContainment ?? detectContainment)();
  checks.push({
    name: 'descendant-containment',
    required: false,
    status: containment.liveExecutionReady ? 'ok' : 'warn',
    detail: containment.detail,
  });

  const missingPrerequisites = checks
    .filter((c) => c.required && c.status === 'missing')
    .map((c) => c.name);

  const capabilities = capabilityStatuses();

  // Core platform safety is independent of any single provider's state.
  const core = computeCoreReadiness({
    runnerCapabilityAvailable: liveExecutionCapabilityAvailable,
    containmentReady: containment.liveExecutionReady,
    containmentDetail: containment.detail,
    missingRequiredPrerequisites: missingPrerequisites,
  });

  // Provider health is computed independently per provider: one provider's
  // failure never changes another provider's entry or blocks its evidence.
  const providerReadiness = providerInfos.map((info) => computeProviderReadiness(info));
  const liveExecution = computeLiveExecutionReadiness(core, providerReadiness);
  const multiProvider = computeMultiProviderReadiness(liveExecution);
  const liveExecutionBlockers = liveExecution.blockers;

  // Inspection health is independent of foreground execution readiness.
  const inspectionEnvironmentIssues: string[] = [];
  if (missingPrerequisites.length > 0) {
    inspectionEnvironmentIssues.push(`missing prerequisites: ${missingPrerequisites.join(', ')}`);
  }
  if (inputs.configuredProjects.length === 0) {
    inspectionEnvironmentIssues.push('no projects configured');
  }

  // Foreground M1 activation never implies unattended/background authority.
  const liveCap = capabilities.find((c) => c.capability === 'live-agent-execution');
  const overnightExecutionReasons: string[] = [];
  if (!liveCap?.available) {
    overnightExecutionReasons.push(
      `live agent execution is unavailable in this build (${liveCap?.milestone ?? 'M1'})`,
    );
  }
  overnightExecutionReasons.push(...liveExecutionBlockers);
  overnightExecutionReasons.push(
    'background execution requires an unattended project policy and an explicitly started daemon',
  );
  if (missingPrerequisites.length > 0) {
    overnightExecutionReasons.push(`missing prerequisites: ${missingPrerequisites.join(', ')}`);
  }
  const usableProvider = providerInfos.some((p) => p.installed && p.authenticated);
  if (!usableProvider) {
    overnightExecutionReasons.push(
      'no verified+authenticated agent provider (resolution-only discovery is not a provider ' +
        'lifecycle probe)',
    );
  }
  if (inputs.configuredProjects.length === 0) {
    overnightExecutionReasons.push('no projects configured');
  }
  if (
    platform() === 'darwin' &&
    !checks.some((c) => c.name === 'caffeinate' && c.status === 'ok')
  ) {
    overnightExecutionReasons.push('caffeinate unavailable: machine may sleep mid-run');
  }

  return {
    os: `${platform()} ${release()}`,
    checks: checks.map((c) => ({ ...c, detail: redactText(c.detail) })),
    providers: providerInfos,
    configuredProjects: inputs.configuredProjects,
    missingPrerequisites,
    overnightExecution: 'unavailable',
    overnightExecutionReasons,
    inspectionEnvironmentOk: inspectionEnvironmentIssues.length === 0,
    inspectionEnvironmentIssues,
    liveExecutionReady: liveExecution.ready,
    liveExecutionBlockers,
    capabilities,
    core,
    providerReadiness,
    liveExecution,
    multiProviderReady: multiProvider.ready,
    multiProvider,
  };
}
