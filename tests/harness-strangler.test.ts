import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_REUSE, missingRetainedCapabilities } from '../src/harness/capabilities.js';
import { liveDshStatus, runHarnessCli } from '../src/harness/cli.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  EMPTY_CORDIS_PATCH,
  MAJOR_KERNEL_LOCAL_SPEC,
  MAJOR_KERNEL_PATCH,
  MAJOR_WORKSTATION_WEB_PATCH,
  bundleManifest,
  majorKernelBundle,
  majorWorkstationHeadlessProfile,
  majorWorkstationWebProfile,
  profileManifest,
} from '../src/harness/composition.js';
import { conformancePassed, runHarnessConformance } from '../src/harness/conformance.js';
import { buildHarnessInstallPlan } from '../src/harness/install-plan.js';
import { DEEPSEEK_HARNESS_PIN, deepSeekHarnessPinSchema } from '../src/harness/pin.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function writeReadyDshInstallation(dshHome: string): void {
  mkdirSync(join(dshHome, 'runtime/node_modules/.bin'), { recursive: true });
  writeFileSync(
    join(dshHome, 'major-install.json'),
    JSON.stringify({
      schemaVersion: 1,
      pinVersion: DEEPSEEK_HARNESS_PIN.npm.version,
      attestedCommit: DEEPSEEK_HARNESS_PIN.git.attestedCommit,
      dshHome,
      phase: 'cutover',
      defaultRuntime: 'dsh-local',
    }),
  );
  const executable = join(dshHome, 'runtime/node_modules/.bin/dsh');
  writeFileSync(executable, '#!/usr/bin/env node\n');
  chmodSync(executable, 0o755);
  for (const profile of ['major-workstation-web', 'major-workstation-headless']) {
    const profileDirectory = join(dshHome, 'profiles', profile);
    mkdirSync(profileDirectory, { recursive: true });
    for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      writeFileSync(join(profileDirectory, file), '{}\n');
    }
  }
}

describe('DeepSeek Harness strangler pin', () => {
  it('pins an exact RC and refuses range or dist-tag resolution', () => {
    expect(DEEPSEEK_HARNESS_PIN.npm.version).toBe('0.1.0-rc.8');
    expect(DEEPSEEK_HARNESS_PIN.npm.pinPolicy).toBe('exact-version');
    expect(DEEPSEEK_HARNESS_PIN.git.declaredTag).toBe('dsh-v0.1.0-rc.8');
    expect(DEEPSEEK_HARNESS_PIN.git.attestedCommit).toBe(
      '141eb6fef83422698aef7a981029e843e8161534',
    );
    expect(DEEPSEEK_HARNESS_PIN.npm.integrities['@deepseek-ai/dsh']).toMatch(/^sha512-/);
    expect(DEEPSEEK_HARNESS_PIN.npm.runtimePeers.packages).toEqual({
      react: '18.3.1',
      'react-dom': '18.3.1',
    });
    expect(() =>
      deepSeekHarnessPinSchema.parse({
        ...DEEPSEEK_HARNESS_PIN,
        npm: { ...DEEPSEEK_HARNESS_PIN.npm, version: '^0.1.0' },
      }),
    ).toThrow();
  });
});

describe('DeepSeek Harness workstation composition', () => {
  it('stacks official base first and Major kernel last on both Mac profiles', () => {
    const web = majorWorkstationWebProfile();
    const headless = majorWorkstationHeadlessProfile();
    expect(web.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-subagent-claude-code',
      '@major/dsh-kernel',
    ]);
    expect(headless.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
      '@deepseek-ai/dsh-subagent-codex',
      '@deepseek-ai/dsh-subagent-claude-code',
      '@major/dsh-kernel',
    ]);
    expect(web.autoStartDaemon).toBe(false);
    expect(headless.attachRufloGlobally).toBe(false);
    expect(web.listen).toBe('127.0.0.1');
  });

  it('pins the web profile to the upstream browse directory picker on loopback', () => {
    const web = majorWorkstationWebProfile();
    expect(web.patch).toContain('id: agent-presets');
    expect(web.patch).toContain('default: major');
    expect(web.patch).toContain('directory-picker-browse');
    expect(web.patch).toContain('@deepseek-ai/dsh-host-directory-picker-browse');
    expect(web.patch).toContain('@deepseek-ai/dsh-client-ui-directory-picker-browse');
    expect(web.patch).toContain('disabled: true');
    expect(majorWorkstationHeadlessProfile().patch).toBe(EMPTY_CORDIS_PATCH);
  });

  it('keeps the web-only preset override out of the shared headless kernel', () => {
    expect(MAJOR_KERNEL_PATCH).toContain('id: agent-default-model');
    expect(MAJOR_KERNEL_PATCH).toContain('provider: major');
    expect(MAJOR_KERNEL_PATCH).toContain('model: composer');
    expect(MAJOR_KERNEL_PATCH).not.toContain('id: agent-presets');
    expect(MAJOR_WORKSTATION_WEB_PATCH).toContain('id: agent-presets');
  });

  it('keeps generated composition exactly aligned with the shipped patches', () => {
    expect(
      readFileSync(
        resolve('distribution/deepseek-harness/bundles/major-kernel/cordis.patch.yml'),
        'utf8',
      ),
    ).toBe(MAJOR_KERNEL_PATCH);
    expect(
      readFileSync(
        resolve('distribution/deepseek-harness/profiles/major-workstation-web/cordis.patch.yml'),
        'utf8',
      ),
    ).toBe(MAJOR_WORKSTATION_WEB_PATCH);
    expect(
      readFileSync(
        resolve(
          'distribution/deepseek-harness/profiles/major-workstation-headless/cordis.patch.yml',
        ),
        'utf8',
      ),
    ).toBe(EMPTY_CORDIS_PATCH);
  });

  it('preserves every KEEP Major capability behind the DSH kernel', () => {
    expect(
      missingRetainedCapabilities(CAPABILITY_REUSE.map((record) => record.capability)),
    ).toEqual([]);
    expect(majorKernelBundle().patch).toContain("name: '@major/dsh-kernel'");
    expect(majorKernelBundle().patch).toContain('provider: major');
    expect(majorKernelBundle().patch).toContain('model: composer');
    expect(majorWorkstationWebProfile().patch).toContain('default: major');
    expect(
      readFileSync(
        resolve('distribution/deepseek-harness/agent-presets/major/agent.cordis.yml'),
        'utf8',
      ).trimEnd(),
    ).toMatch(/\[\]$/);
    expect(
      readFileSync(resolve('distribution/deepseek-harness/agent-presets/major/preset.yml'), 'utf8'),
    ).toContain('name: Major');
    expect(majorKernelBundle().patch).toContain('providerName: claude-review');
    expect(majorKernelBundle().patch).toContain('id: subagent-codex');
    expect(majorKernelBundle().patch).toContain('permissionMode: approve-for-me');
    expect(majorKernelBundle().patch).toContain(
      "CODEX_HOME: !!js dshHomePath('providers/codex/default')",
    );
    expect(majorKernelBundle().patch).toContain('permissionMode: plan');
    expect(DEFAULT_EXECUTION_BACKEND).toBe('dsh');
  });

  it('uses the official bundle manifest and a resolvable local profile dependency', () => {
    expect(bundleManifest(majorKernelBundle()).dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(bundleManifest(majorKernelBundle()).dsh.client).toEqual({
      inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-conversation'],
      platform: 'web',
    });
    expect(bundleManifest(majorKernelBundle()).main).toBe('./index.js');
    expect(bundleManifest(majorKernelBundle()).exports['./client']).toBe('./client.js');
    expect(bundleManifest(majorKernelBundle()).exports['./lima-subprocess']).toBe(
      './lima-subprocess.js',
    );
    expect(bundleManifest(majorKernelBundle()).exports['./package.json']).toBe('./package.json');
    expect(bundleManifest(majorKernelBundle()).files).toContain('route-context.js');
    expect(bundleManifest(majorKernelBundle()).files).not.toContain('command-input.js');
    expect(
      profileManifest(majorWorkstationHeadlessProfile()).dependencies['@major/dsh-kernel'],
    ).toBe(MAJOR_KERNEL_LOCAL_SPEC);
  });
});

describe('DeepSeek Harness cutover install plan', () => {
  it('requires an attested pin and defaults live traffic to local DSH', () => {
    const plan = buildHarnessInstallPlan(REPO_ROOT);
    expect(plan.pinVersion).toBe('0.1.0-rc.8');
    expect(plan.attestedCommit).toBe('141eb6fef83422698aef7a981029e843e8161534');
    expect(plan.executionBackend).toBe('dsh');
    expect(plan.defaultRuntime).toBe('dsh-local');
    expect(plan.compatibilityRuntimes).toEqual(['dsh-lima', 'legacy-major-lima']);
    expect(plan.profiles.map((profile) => profile.id)).toEqual([
      'major-workstation-web',
      'major-workstation-headless',
    ]);
    expect(plan.npmInstalls).toHaveLength(9);
    for (const item of plan.npmInstalls.filter(({ package: name }) =>
      name.startsWith('@deepseek-ai/'),
    )) {
      expect(item.version).toBe('0.1.0-rc.8');
    }
    expect(plan.npmInstalls.map(({ package: name }) => name)).toEqual(
      expect.arrayContaining(['react', 'react-dom']),
    );
    expect(plan.npmInstalls.every(({ integrity }) => integrity.startsWith('sha512-'))).toBe(true);
    expect(plan.commands.join('\n')).not.toMatch(/latest|next|\^|~/);
  });

  it('dry-runs on the macOS system Bash without mutating the harness home', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-dry-run-'));
    const target = join(root, 'must-not-exist');
    try {
      const output = execFileSync(
        '/bin/bash',
        [resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh'), '--dry-run'],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            MAJOR_DSH_HOME: target,
          },
          encoding: 'utf8',
        },
      );
      expect(output).toContain('mode: dry-run');
      expect(output).toContain('disk preflight before DSH/Lima install');
      expect(output).toContain('stage');
      expect(output).toContain('write exact runtime manifest');
      expect(output).toContain('link shared runtime');
      expect(output).toContain('compose pinned profile major-workstation-web');
      expect(output).toContain('stage isolated Codex worker home');
      expect(output).toContain('Major.app');
      expect(output).toContain('Normal trusted repository execution defaults to DSH local');
      expect(output).toContain('MAJOR_SESSION_HOST');
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stages the app without an empty array and propagates stager failures in both modes', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-live-stage-'));
    const fakeBin = join(root, 'bin');
    const fakeBash = join(fakeBin, 'bash');
    try {
      mkdirSync(fakeBin);
      writeFileSync(fakeBash, '#!/bin/sh\nprintf "%s\\n" "$*"\n');
      chmodSync(fakeBash, 0o755);
      const installer = readFileSync(
        resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh'),
        'utf8',
      );
      const functionSource = installer.match(
        /stage_workstation_app\(\) \{[\s\S]*?\n\}\n\nwrite_install_record\(\)/,
      )?.[0];
      expect(functionSource).toBeDefined();
      expect(installer).toContain('stage_named_codex_worker_homes');
      expect(installer).toContain('providerName: codex-{account_label}');
      const command = (dryRun: 0 | 1) =>
        [
          'ROOT=/tmp/source',
          'MAJOR_HOME=/tmp/major-home',
          'DSH_HOME=/tmp/dsh-home',
          `DRY_RUN=${dryRun}`,
          functionSource!.replace(/\n\nwrite_install_record\(\)$/, ''),
          'stage_workstation_app',
        ].join('\n');
      const output = execFileSync('/bin/bash', ['-uc', command(0)], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      });
      expect(output.trim()).toBe('/tmp/source/scripts/stage-major-workstation-app.sh');
      const dryRunOutput = execFileSync('/bin/bash', ['-uc', command(1)], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      });
      expect(dryRunOutput.trim()).toBe(
        '/tmp/source/scripts/stage-major-workstation-app.sh --dry-run',
      );

      writeFileSync(fakeBash, '#!/bin/sh\nexit 37\n');
      for (const dryRun of [0, 1] as const) {
        const failed = spawnSync('/bin/bash', ['-uc', command(dryRun)], {
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
        });
        expect(failed.status).toBe(37);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects DSH composition errors even when dump-config exits zero', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-compose-error-'));
    const runtime = join(root, 'runtime');
    const fakeDsh = join(runtime, 'node_modules/.bin/dsh');
    try {
      mkdirSync(join(runtime, 'node_modules/.bin'), { recursive: true });
      writeFileSync(
        fakeDsh,
        '#!/bin/sh\necho \'dsh: [@major/dsh-kernel] patch: entry "agent-presets" not found\' >&2\nexit 0\n',
      );
      chmodSync(fakeDsh, 0o755);
      const installer = readFileSync(
        resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh'),
        'utf8',
      );
      const functionSource = installer.match(
        /verify_profile_composition\(\) \{[\s\S]*?\n\}\n\nstage_workstation_app\(\)/,
      )?.[0];
      expect(functionSource).toBeDefined();
      const command = [
        `RUNTIME_DIR=${JSON.stringify(runtime)}`,
        `DSH_HOME=${JSON.stringify(join(root, 'home'))}`,
        'DRY_RUN=0',
        'fail() { echo "$*" >&2; return 1; }',
        functionSource!.replace(/\n\nstage_workstation_app\(\)$/, ''),
        'verify_profile_composition major-workstation-headless',
      ].join('\n');
      const result = spawnSync('/bin/bash', ['-uc', command], { encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'dsh: [@major/dsh-kernel] patch: entry "agent-presets" not found',
      );
      expect(result.stderr).toContain(
        'DSH profile composition reported an error: major-workstation-headless',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores DSH state and installer-owned Major.app after a post-activation failure', () => {
    const installerSource = readFileSync(
      resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh'),
      'utf8',
    );
    expect(installerSource).toContain('APP_ACTIVATED=1\nstage_workstation_app');
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-rollback-'));
    const home = join(root, 'major-home');
    const dshHome = join(home, 'dsh-harness');
    const codexHome = join(root, 'codex');
    const fakeBin = join(root, 'bin');
    const appDir = join(root, 'Applications');
    const app = join(appDir, 'Major.app');
    const runtimeMarker = join(dshHome, 'runtime/rollback-runtime.txt');
    const profileMarker = join(dshHome, 'profiles/major-workstation-web/prior-profile.txt');
    const sessionMarker = join(dshHome, 'sessions/preserved.txt');
    const chromeMarker = join(dshHome, 'chrome-profile/preserved.txt');
    try {
      for (const path of [
        join(dshHome, 'runtime'),
        join(dshHome, 'profiles/major-workstation-web'),
        join(dshHome, 'sessions'),
        join(dshHome, 'chrome-profile'),
        codexHome,
        fakeBin,
        join(app, 'Contents/Resources'),
      ]) {
        mkdirSync(path, { recursive: true });
      }
      writeFileSync(runtimeMarker, 'installed rollback runtime\n');
      writeFileSync(profileMarker, 'prior managed profile\n');
      writeFileSync(sessionMarker, 'session state\n');
      writeFileSync(chromeMarker, 'chrome state\n');
      writeFileSync(
        join(app, 'Contents/Resources/major-dsh-installer-owned'),
        'major-dsh-workstation-app-v1\n',
      );
      writeFileSync(join(app, 'prior-app.txt'), 'exact prior app\n');
      writeFileSync(join(codexHome, 'auth.json'), '{}\n');
      writeFileSync(
        join(fakeBin, 'npm'),
        '#!/bin/sh\npython3 - "$2" <<\'PY\'\n' +
          'import json, os, sys\n' +
          'pin=json.load(open(os.environ["MAJOR_TEST_PIN"]))\n' +
          'name=sys.argv[1].rsplit("@", 1)[0]\n' +
          'print(({**pin["npm"]["integrities"], **pin["npm"]["runtimePeers"]["integrities"]})[name])\n' +
          'PY\n',
      );
      writeFileSync(
        join(fakeBin, 'pnpm'),
        '#!/bin/sh\n' +
          'while [ "$#" -gt 0 ]; do [ "$1" = --dir ] && { shift; dir=$1; }; shift; done\n' +
          'mkdir -p "$dir/node_modules/.bin" "$dir/node_modules/@deepseek-ai/dsh/config/agent-presets/standard"\n' +
          'printf \'#!/bin/sh\\necho composed\\n\' > "$dir/node_modules/.bin/dsh"\n' +
          'chmod +x "$dir/node_modules/.bin/dsh"\n',
      );
      chmodSync(join(fakeBin, 'npm'), 0o755);
      chmodSync(join(fakeBin, 'pnpm'), 0o755);
      const result = spawnSync(
        '/bin/bash',
        [resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh')],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
            MAJOR_HOME: home,
            MAJOR_DSH_HOME: dshHome,
            MAJOR_DSH_CODEX_PROFILE_HOME: codexHome,
            MAJOR_APP_DIR: appDir,
            MAJOR_TEST_PIN: resolve(REPO_ROOT, 'distribution/deepseek-harness/pin.json'),
            MAJOR_DSH_TEST_FAIL_AFTER_APP_ACTIVATION: '1',
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('injected failure after app activation');
      expect(result.stderr).toContain('prior installer-managed state restored');
      expect(readFileSync(runtimeMarker, 'utf8')).toBe('installed rollback runtime\n');
      expect(readFileSync(profileMarker, 'utf8')).toBe('prior managed profile\n');
      expect(readFileSync(sessionMarker, 'utf8')).toBe('session state\n');
      expect(readFileSync(chromeMarker, 'utf8')).toBe('chrome state\n');
      expect(readFileSync(join(app, 'prior-app.txt'), 'utf8')).toBe('exact prior app\n');
      expect(existsSync(join(app, 'Contents/MacOS/Major'))).toBe(false);
      expect(existsSync(join(dshHome, 'major-install.json'))).toBe(false);

      rmSync(app, { recursive: true, force: true });
      const absentResult = spawnSync(
        '/bin/bash',
        [resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh')],
        {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
            MAJOR_HOME: home,
            MAJOR_DSH_HOME: dshHome,
            MAJOR_DSH_CODEX_PROFILE_HOME: codexHome,
            MAJOR_APP_DIR: appDir,
            MAJOR_TEST_PIN: resolve(REPO_ROOT, 'distribution/deepseek-harness/pin.json'),
            MAJOR_DSH_TEST_FAIL_AFTER_APP_ACTIVATION: '1',
          },
        },
      );
      expect(absentResult.status).not.toBe(0);
      expect(absentResult.stderr).toContain('injected failure after app activation');
      expect(existsSync(app)).toBe(false);
      expect(readFileSync(runtimeMarker, 'utf8')).toBe('installed rollback runtime\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('DeepSeek Harness cutover conformance', () => {
  it('reports only static distribution conformance', () => {
    const report = runHarnessConformance(REPO_ROOT);
    expect(report.checks.filter((item) => !item.ok)).toEqual([]);
    expect(conformancePassed(report)).toBe(true);
    expect(report.phase).toBe('cutover');
    expect(report.executionBackend).toBe('dsh');
    expect(report).not.toHaveProperty('liveDshInstalled');
    expect(report).not.toHaveProperty('ready');
    expect(CURRENT_HARNESS_MIGRATION_PHASE).toBe('cutover');
  });
});

describe('major harness CLI', () => {
  const logs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn> | undefined;
  let priorRoot: string | undefined;

  afterEach(() => {
    logSpy?.mockRestore();
    logSpy = undefined;
    if (priorRoot === undefined) delete process.env.MAJOR_HARNESS_ROOT;
    else process.env.MAJOR_HARNESS_ROOT = priorRoot;
  });

  function capture(): void {
    logs.length = 0;
    logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(String(line));
    });
    priorRoot = process.env.MAJOR_HARNESS_ROOT;
    process.env.MAJOR_HARNESS_ROOT = REPO_ROOT;
  }

  it('ignores unrelated argv', async () => {
    expect(await runHarnessCli(['provider', 'status'])).toBe(false);
  });

  it('derives installation from the attested receipt and readiness from required paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-status-'));
    const dshHome = join(root, 'dsh-harness');
    try {
      mkdirSync(dshHome, { recursive: true });
      writeFileSync(
        join(dshHome, 'major-install.json'),
        JSON.stringify({
          schemaVersion: 1,
          pinVersion: DEEPSEEK_HARNESS_PIN.npm.version,
          attestedCommit: DEEPSEEK_HARNESS_PIN.git.attestedCommit,
          dshHome,
          phase: 'cutover',
          defaultRuntime: 'dsh-local',
        }),
      );

      expect(liveDshStatus({ MAJOR_DSH_HOME: dshHome })).toEqual({
        liveDshInstalled: true,
        ready: false,
      });

      mkdirSync(join(dshHome, 'runtime/node_modules/.bin'), { recursive: true });
      const dshExecutable = join(dshHome, 'runtime/node_modules/.bin/dsh');
      writeFileSync(dshExecutable, '#!/usr/bin/env node\n');
      chmodSync(dshExecutable, 0o755);
      for (const path of [
        'profiles/major-workstation-web',
        'profiles/major-workstation-headless',
      ]) {
        mkdirSync(join(dshHome, path), { recursive: true });
        for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
          writeFileSync(join(dshHome, path, file), '{}\n');
        }
      }
      expect(liveDshStatus({ MAJOR_DSH_HOME: dshHome })).toEqual({
        liveDshInstalled: true,
        ready: true,
      });

      writeFileSync(
        join(dshHome, 'major-install.json'),
        JSON.stringify({
          schemaVersion: 1,
          pinVersion: DEEPSEEK_HARNESS_PIN.npm.version,
          attestedCommit: 'stale',
          dshHome,
          phase: 'cutover',
          defaultRuntime: 'dsh-local',
        }),
      );
      expect(liveDshStatus({ MAJOR_DSH_HOME: dshHome })).toEqual({
        liveDshInstalled: false,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is not ready when the installed dsh file is not executable', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-status-'));
    const dshHome = join(root, 'dsh-harness');
    try {
      writeReadyDshInstallation(dshHome);
      chmodSync(join(dshHome, 'runtime/node_modules/.bin/dsh'), 0o644);
      expect(liveDshStatus({ MAJOR_DSH_HOME: dshHome })).toEqual({
        liveDshInstalled: true,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is not ready when an installed profile is missing a composition file', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-dsh-status-'));
    const dshHome = join(root, 'dsh-harness');
    try {
      writeReadyDshInstallation(dshHome);
      rmSync(join(dshHome, 'profiles/major-workstation-web/cordis.patch.yml'));
      expect(liveDshStatus({ MAJOR_DSH_HOME: dshHome })).toEqual({
        liveDshInstalled: true,
        ready: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints pin, composition and passing conformance', async () => {
    capture();
    expect(await runHarnessCli(['harness', 'status'])).toBe(true);
    expect(logs.join('\n')).toMatch(/phase: cutover/);
    expect(logs.join('\n')).toMatch(/live execution backend: dsh/);
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'compose'])).toBe(true);
    expect(logs.join('\n')).toContain(
      '@deepseek-ai/dsh-base -> @deepseek-ai/dsh-headless -> @deepseek-ai/dsh-subagent-codex -> @deepseek-ai/dsh-subagent-claude-code -> @major/dsh-kernel',
    );
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'conformance'])).toBe(true);
    expect(logs.join('\n')).toMatch(/configured execution backend: dsh/);
    expect(logs.join('\n')).toMatch(/PASS pin.exact/);
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'install-plan'])).toBe(true);
    expect(logs.join('\n')).toMatch(/default runtime: dsh-local/);
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'workstation-app'])).toBe(true);
    expect(logs.join('\n')).toMatch(/profile: major-workstation-web/);
    expect(logs.join('\n')).toMatch(/listen: 127.0.0.1:3080/);
  });
});
