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
import { runHarnessCli } from '../src/harness/cli.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  EMPTY_CORDIS_PATCH,
  MAJOR_KERNEL_LOCAL_SPEC,
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
    expect(web.patch).toContain('directory-picker-browse');
    expect(web.patch).toContain('@deepseek-ai/dsh-host-directory-picker-browse');
    expect(web.patch).toContain('@deepseek-ai/dsh-client-ui-directory-picker-browse');
    expect(web.patch).toContain('disabled: true');
    expect(majorWorkstationHeadlessProfile().patch).toBe(EMPTY_CORDIS_PATCH);
  });

  it('preserves every KEEP Major capability behind the DSH kernel', () => {
    expect(
      missingRetainedCapabilities(CAPABILITY_REUSE.map((record) => record.capability)),
    ).toEqual([]);
    expect(majorKernelBundle().patch).toContain("name: '@major/dsh-kernel'");
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
});

describe('DeepSeek Harness cutover conformance', () => {
  it('passes the distribution contract without claiming live dsh or cleanup', () => {
    const report = runHarnessConformance(REPO_ROOT);
    expect(report.checks.filter((item) => !item.ok)).toEqual([]);
    expect(conformancePassed(report)).toBe(true);
    expect(report.phase).toBe('cutover');
    expect(report.executionBackend).toBe('dsh');
    expect(report.liveDshInstalled).toBe(false);
    expect(report.ready).toBe(false);
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
