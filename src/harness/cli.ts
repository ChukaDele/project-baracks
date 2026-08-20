import { resolve } from 'node:path';
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
import { DEEPSEEK_HARNESS_PIN } from './pin.js';

const HARNESS_HELP = `major harness — DeepSeek Harness distribution (shadow strangler)

  harness status [--json]
  harness compose [--json]
  harness conformance [--json]
`;

function repoRootFromCwd(): string {
  return resolve(process.env.MAJOR_HARNESS_ROOT ?? process.cwd());
}

export async function runHarnessCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'harness') return false;
  const command = args[1];
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HARNESS_HELP);
    return true;
  }
  const json = args.includes('--json');
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
    `kernel ${majorKernelBundle().name}: shadow no-op patch; Major remains live outside dsh`,
    `web ${web.id}: ${web.bundles.join(' -> ')}`,
    `headless ${headless.id}: ${headless.bundles.join(' -> ')}`,
    `default backend: ${DEFAULT_EXECUTION_BACKEND}`,
  ].join('\n');
}
