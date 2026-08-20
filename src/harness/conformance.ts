import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPABILITY_REUSE,
  MAJOR_RETAINED_CAPABILITIES,
  missingRetainedCapabilities,
} from './capabilities.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  DSH_BASE_BUNDLE,
  HARNESS_MIGRATION_PHASES,
  MAJOR_KERNEL_BUNDLE,
  PROFILE_PNPM_WORKSPACE,
  bundleManifest,
  majorKernelBundle,
  majorWorkstationHeadlessProfile,
  majorWorkstationWebProfile,
  pinnedBundleVersion,
  profileManifest,
  type DshProfile,
} from './composition.js';
import {
  DEEPSEEK_HARNESS_PIN,
  HARNESS_PIN_RELATIVE_PATH,
  deepSeekHarnessPinSchema,
} from './pin.js';
import {
  WORKSTATION_APP_BUNDLE,
  WORKSTATION_CHROME_HOST,
  WORKSTATION_DSH_APP_ARGS,
  WORKSTATION_FORBIDDEN,
  WORKSTATION_LISTEN_HOST,
  WORKSTATION_PORT,
  WORKSTATION_PROFILE,
} from './workstation-app.js';

export interface ConformanceCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface HarnessConformanceReport {
  phase: typeof CURRENT_HARNESS_MIGRATION_PHASE;
  executionBackend: typeof DEFAULT_EXECUTION_BACKEND;
  pinVersion: string;
  liveDshInstalled: false;
  ready: false;
  checks: ConformanceCheck[];
}

function check(id: string, ok: boolean, detail: string): ConformanceCheck {
  return { id, ok, detail };
}

function readRepoFile(repoRoot: string, relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function assertProfileComposition(profile: DshProfile): ConformanceCheck[] {
  const first = profile.bundles[0];
  const last = profile.bundles[profile.bundles.length - 1];
  const present = CAPABILITY_REUSE.map((record) => record.capability);
  const missing = missingRetainedCapabilities(present);
  return [
    check(
      `${profile.id}.base-first`,
      first === DSH_BASE_BUNDLE,
      `${profile.id} must start with ${DSH_BASE_BUNDLE}`,
    ),
    check(
      `${profile.id}.kernel-last-bundle`,
      last === MAJOR_KERNEL_BUNDLE,
      `${profile.id} must overlay ${MAJOR_KERNEL_BUNDLE} after upstream bundles`,
    ),
    check(
      `${profile.id}.no-daemon`,
      profile.autoStartDaemon === false && profile.attachRufloGlobally === false,
      `${profile.id} must not auto-start a daemon or attach Ruflo globally`,
    ),
    check(
      `${profile.id}.loopback`,
      profile.listen === '127.0.0.1',
      `${profile.id} must bind loopback only`,
    ),
    check(
      `${profile.id}.capabilities`,
      missing.length === 0,
      missing.length === 0
        ? `${profile.id} preserves ${MAJOR_RETAINED_CAPABILITIES.length} Major capabilities`
        : `${profile.id} missing capabilities: ${missing.join(', ')}`,
    ),
    check(
      `${profile.id}.lima-default`,
      DEFAULT_EXECUTION_BACKEND === 'lima',
      `${profile.id} live traffic must remain on ${DEFAULT_EXECUTION_BACKEND}`,
    ),
  ];
}

function distributionMatches(repoRoot: string): ConformanceCheck[] {
  const pinOnDisk = deepSeekHarnessPinSchema.parse(
    JSON.parse(readRepoFile(repoRoot, HARNESS_PIN_RELATIVE_PATH)) as unknown,
  );
  const kernelPatch = readRepoFile(
    repoRoot,
    'distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml',
  );
  const kernelManifest = JSON.parse(
    readRepoFile(repoRoot, 'distribution/deepseek-harness/bundles/major-kernel/package.json'),
  ) as ReturnType<typeof bundleManifest>;
  const webManifest = JSON.parse(
    readRepoFile(
      repoRoot,
      'distribution/deepseek-harness/profiles/major-workstation-web/package.json',
    ),
  ) as ReturnType<typeof profileManifest>;
  const headlessManifest = JSON.parse(
    readRepoFile(
      repoRoot,
      'distribution/deepseek-harness/profiles/major-workstation-headless/package.json',
    ),
  ) as ReturnType<typeof profileManifest>;
  return [
    check(
      'pin.disk-matches-runtime',
      JSON.stringify(pinOnDisk) === JSON.stringify(DEEPSEEK_HARNESS_PIN),
      `${HARNESS_PIN_RELATIVE_PATH} must match src/harness/pin.ts`,
    ),
    check(
      'bundle.patch-matches-runtime',
      kernelPatch === majorKernelBundle().patch,
      'major-kernel cordis.patch.yml must match the runtime bundle',
    ),
    check(
      'bundle.manifest-matches-upstream',
      JSON.stringify(kernelManifest) === JSON.stringify(bundleManifest(majorKernelBundle())),
      'major-kernel must use the upstream dsh.bundle.patch manifest shape',
    ),
    check(
      'web.patch-matches-runtime',
      readRepoFile(
        repoRoot,
        'distribution/deepseek-harness/profiles/major-workstation-web/cordis.patch.yml',
      ) === majorWorkstationWebProfile().patch,
      'web profile patch must match composition',
    ),
    check(
      'headless.patch-matches-runtime',
      readRepoFile(
        repoRoot,
        'distribution/deepseek-harness/profiles/major-workstation-headless/cordis.patch.yml',
      ) === majorWorkstationHeadlessProfile().patch,
      'headless profile patch must match composition',
    ),
    check(
      'web.profile-bundles',
      JSON.stringify(webManifest) === JSON.stringify(profileManifest(majorWorkstationWebProfile())),
      'web profile bundles must match composition',
    ),
    check(
      'headless.profile-bundles',
      JSON.stringify(headlessManifest) ===
        JSON.stringify(profileManifest(majorWorkstationHeadlessProfile())),
      'headless profile bundles must match composition',
    ),
    check(
      'web.profile-pnpm-layout',
      readRepoFile(
        repoRoot,
        'distribution/deepseek-harness/profiles/major-workstation-web/pnpm-workspace.yaml',
      ) === PROFILE_PNPM_WORKSPACE,
      'web profile must use the upstream hoisted out-of-tree plugin layout',
    ),
    check(
      'headless.profile-pnpm-layout',
      readRepoFile(
        repoRoot,
        'distribution/deepseek-harness/profiles/major-workstation-headless/pnpm-workspace.yaml',
      ) === PROFILE_PNPM_WORKSPACE,
      'headless profile must use the upstream hoisted out-of-tree plugin layout',
    ),
  ];
}

function workstationAppMatches(repoRoot: string): ConformanceCheck[] {
  const launcher = readRepoFile(repoRoot, 'scripts/start-major-workstation.sh');
  const stager = readRepoFile(repoRoot, 'scripts/stage-major-workstation-app.sh');
  const installer = readRepoFile(repoRoot, 'scripts/install-deepseek-harness-pin.sh');
  const appExec = readRepoFile(
    repoRoot,
    'distribution/deepseek-harness/macos/Major.app/Contents/MacOS/Major',
  );
  const plist = readRepoFile(
    repoRoot,
    'distribution/deepseek-harness/macos/Major.app/Contents/Info.plist',
  );
  const combined = `${launcher}\n${stager}\n${installer}\n${appExec}\n${plist}`;
  const forbiddenHit = WORKSTATION_FORBIDDEN.find((token) => combined.includes(token));
  return [
    check(
      'workstation.profile',
      launcher.includes(`PROFILE="${WORKSTATION_PROFILE}"`) &&
        launcher.includes(`LISTEN_HOST="${WORKSTATION_LISTEN_HOST}"`) &&
        launcher.includes(`PORT="${WORKSTATION_PORT}"`),
      'launcher must boot the pinned web profile on loopback 3080',
    ),
    check(
      'workstation.dsh-args',
      WORKSTATION_DSH_APP_ARGS.every((arg) => launcher.includes(arg)),
      'launcher must pass official --host/--port/--no-open/--trusted-host app args',
    ),
    check(
      'workstation.chrome-app-mode',
      launcher.includes('--app=') &&
        launcher.includes(WORKSTATION_CHROME_HOST) &&
        launcher.includes('--user-data-dir='),
      'launcher must open Chrome app-mode against localhost with a DSH-home profile',
    ),
    check(
      'workstation.single-instance',
      launcher.includes('workstation.lock') && launcher.includes('already running'),
      'launcher must refuse a second live lock',
    ),
    check(
      'workstation.logs',
      launcher.includes('$DSH_HOME/logs/workstation.log'),
      'launcher logs must stay under the DSH home',
    ),
    check(
      'workstation.preserve-major-path',
      launcher.includes('ORIGINAL_PATH') && launcher.includes('preserve PATH'),
      'launcher must preserve the current Major PATH',
    ),
    check(
      'workstation.no-desktop-runtime',
      forbiddenHit === undefined &&
        installer.includes('stage_workstation_app') &&
        stager.includes(WORKSTATION_APP_BUNDLE) &&
        plist.includes('com.chuka.major.workstation-web') &&
        appExec.includes('start-major-workstation.sh'),
      forbiddenHit === undefined
        ? 'Major.app is installer-managed without Electron, Tauri, or a login agent'
        : `forbidden workstation token: ${forbiddenHit}`,
    ),
  ];
}

export function runHarnessConformance(repoRoot: string): HarnessConformanceReport {
  const pin = DEEPSEEK_HARNESS_PIN;
  const packageJson = JSON.parse(readRepoFile(repoRoot, 'package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const runtimeDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const dshDepNames = Object.keys(runtimeDeps).filter((name) => name.startsWith('@deepseek-ai/'));
  const gateway = readRepoFile(repoRoot, 'src/security/major-gateway.ts');
  const rangeUsed = Object.values(pin.npm.packages).some((version) =>
    pin.npm.forbiddenResolutions.some((token) => version.includes(token)),
  );
  const kernelSource = readRepoFile(
    repoRoot,
    'distribution/deepseek-harness/bundles/major-kernel/index.js',
  );
  const checks: ConformanceCheck[] = [
    check('pin.parse', true, `pinned ${pin.npm.version}`),
    check(
      'pin.exact',
      pin.npm.pinPolicy === 'exact-version' && !rangeUsed,
      'pin forbids latest/next/range resolution',
    ),
    check(
      'pin.family',
      pinnedBundleVersion(DSH_BASE_BUNDLE) === pin.npm.version &&
        pinnedBundleVersion('@deepseek-ai/dsh') === pin.npm.version,
      'dsh family packages share the exact pin',
    ),
    check(
      'pin.attested',
      pin.git.attestedCommit !== null &&
        /^[0-9a-f]{40}$/.test(pin.git.attestedCommit) &&
        Object.values(pin.npm.integrities).every((integrity) => integrity.startsWith('sha512-')) &&
        Object.values(pin.npm.runtimePeers.integrities).every((integrity) =>
          integrity.startsWith('sha512-'),
        ),
      'official release tag commit, dsh packages, and runtime peers are attested',
    ),
    check(
      'deps.not-installed',
      dshDepNames.length === 0,
      dshDepNames.length === 0
        ? 'no live @deepseek-ai dependency until the pin is attested'
        : `unexpected live dsh dependency: ${dshDepNames.join(', ')}`,
    ),
    check(
      'execution.lima-default',
      gateway.includes('export function majorExecutionBackend') &&
        gateway.includes('return new LimaBackend'),
      'majorExecutionBackend still returns LimaBackend',
    ),
    check(
      'phase.shadow',
      CURRENT_HARNESS_MIGRATION_PHASE === 'shadow' &&
        HARNESS_MIGRATION_PHASES.includes(CURRENT_HARNESS_MIGRATION_PHASE),
      `migration phase is ${CURRENT_HARNESS_MIGRATION_PHASE}`,
    ),
    check(
      'reuse.keep-major',
      CAPABILITY_REUSE.every((record) => record.decision === 'KEEP'),
      'every retained Major capability has a KEEP reuse record',
    ),
    check(
      'kernel.subscription-routing',
      kernelSource.includes('MAJOR_SESSION_HOST') &&
        kernelSource.includes('MAJOR_FOREGROUND_DISPATCH') &&
        !kernelSource.includes('NO_CYCLE_MESSAGE') &&
        !kernelSource.includes("'--host', 'codex'") &&
        !kernelSource.includes("'--host', 'claude'") &&
        !kernelSource.includes("'--host', 'cursor'") &&
        !kernelSource.includes("'--host', 'antigravity'"),
      '/major must take MAJOR_SESSION_HOST for admit/attach; Major run still routes the worker',
    ),
    ...assertProfileComposition(majorWorkstationWebProfile()),
    ...assertProfileComposition(majorWorkstationHeadlessProfile()),
    ...distributionMatches(repoRoot),
    ...workstationAppMatches(repoRoot),
  ];

  return {
    phase: CURRENT_HARNESS_MIGRATION_PHASE,
    executionBackend: DEFAULT_EXECUTION_BACKEND,
    pinVersion: pin.npm.version,
    liveDshInstalled: false,
    ready: false,
    checks,
  };
}

export function conformancePassed(report: HarnessConformanceReport): boolean {
  return report.checks.every((item) => item.ok);
}

export function formatHarnessConformance(report: HarnessConformanceReport): string {
  const failed = report.checks.filter((item) => !item.ok);
  const lines = [
    `DeepSeek Harness distribution ${report.pinVersion} (${report.phase})`,
    `live execution backend: ${report.executionBackend}`,
    `live dsh installed: ${report.liveDshInstalled}`,
    `ready: ${report.ready}`,
    ...report.checks.map((item) => `${item.ok ? 'PASS' : 'FAIL'} ${item.id}: ${item.detail}`),
  ];
  if (failed.length > 0) lines.push(`${failed.length} conformance check(s) failed`);
  return lines.join('\n');
}
