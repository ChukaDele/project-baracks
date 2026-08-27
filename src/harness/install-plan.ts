import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  workstationProfiles,
} from './composition.js';
import {
  DEEPSEEK_HARNESS_PIN,
  HARNESS_PIN_RELATIVE_PATH,
  deepSeekHarnessPinSchema,
} from './pin.js';

export interface HarnessNpmInstall {
  package: string;
  version: string;
  integrity: string;
}

export interface HarnessProfileStage {
  id: string;
  relativeSource: string;
  bundles: readonly string[];
}

export interface HarnessInstallPlan {
  phase: typeof CURRENT_HARNESS_MIGRATION_PHASE;
  executionBackend: typeof DEFAULT_EXECUTION_BACKEND;
  pinVersion: string;
  attestedCommit: string;
  dshHome: string;
  npmInstalls: HarnessNpmInstall[];
  profiles: HarnessProfileStage[];
  commands: string[];
  defaultRuntime: 'dsh-local';
  compatibilityRuntimes: readonly ['dsh-lima', 'legacy-major-lima'];
}

function readPinFromRepo(repoRoot: string) {
  return deepSeekHarnessPinSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, HARNESS_PIN_RELATIVE_PATH), 'utf8')) as unknown,
  );
}

export function buildHarnessInstallPlan(
  repoRoot: string,
  options: { dshHome?: string } = {},
): HarnessInstallPlan {
  const pin = readPinFromRepo(repoRoot);
  if (pin.git.attestedCommit === null) {
    throw new Error(
      'DeepSeek Harness pin is not attested; install is forbidden before cutover evidence',
    );
  }
  if (JSON.stringify(pin) !== JSON.stringify(DEEPSEEK_HARNESS_PIN)) {
    throw new Error(`${HARNESS_PIN_RELATIVE_PATH} must match src/harness/pin.ts before install`);
  }

  const dshHome = options.dshHome ?? '${MAJOR_HOME}/dsh-harness';
  const pinnedPackages = {
    ...pin.npm.packages,
    ...pin.npm.runtimePeers.packages,
  };
  const pinnedIntegrities = {
    ...pin.npm.integrities,
    ...pin.npm.runtimePeers.integrities,
  };
  const npmInstalls = Object.entries(pinnedPackages).map(([pkg, version]) => ({
    package: pkg,
    version,
    integrity: pinnedIntegrities[pkg as keyof typeof pinnedIntegrities],
  }));

  const profiles = workstationProfiles().map((profile) => ({
    id: profile.id,
    relativeSource: `distribution/deepseek-harness/profiles/${profile.id}`,
    bundles: profile.bundles,
  }));

  const exactArgs = npmInstalls.map(({ package: name, version }) => `${name}@${version}`).join(' ');

  const commands = [
    `bash scripts/install-deepseek-harness-pin.sh`,
    `# stages ${profiles.map((p) => p.id).join(' and ')} under ${dshHome}`,
    `# stages reversible Major.app launcher (loopback web + Chrome app-mode) under ${dshHome}`,
    `# installs exact npm packages: ${exactArgs}`,
    '# DSH is explicit reference infrastructure; normal work runs through headless Major host execution',
    '# Lima and the legacy Major/Lima pipeline remain explicit compatibility choices',
  ];

  return {
    phase: CURRENT_HARNESS_MIGRATION_PHASE,
    executionBackend: DEFAULT_EXECUTION_BACKEND,
    pinVersion: pin.npm.version,
    attestedCommit: pin.git.attestedCommit,
    dshHome,
    npmInstalls,
    profiles,
    commands,
    defaultRuntime: 'dsh-local',
    compatibilityRuntimes: ['dsh-lima', 'legacy-major-lima'],
  };
}

export function formatHarnessInstallPlan(plan: HarnessInstallPlan): string {
  const lines = [
    `phase: ${plan.phase}`,
    `pin: ${plan.pinVersion} (${plan.attestedCommit.slice(0, 7)})`,
    `dsh home: ${plan.dshHome}`,
    `default runtime: ${plan.defaultRuntime} via ${plan.executionBackend}`,
    `compatibility runtimes: ${plan.compatibilityRuntimes.join(', ')}`,
    'profiles:',
    ...plan.profiles.map((profile) => `  - ${profile.id}: ${profile.bundles.join(' -> ')}`),
    'npm installs:',
    ...plan.npmInstalls.map(
      (item) => `  - ${item.package}@${item.version} (${item.integrity.slice(0, 19)}…)`,
    ),
    'commands:',
    ...plan.commands.map((command) => `  ${command}`),
  ];
  return lines.join('\n');
}
