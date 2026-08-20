import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
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
import { buildHarnessShadowTask } from '../src/harness/shadow-task.js';

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

  it('preserves every KEEP Major capability outside dsh during shadow', () => {
    expect(
      missingRetainedCapabilities(CAPABILITY_REUSE.map((record) => record.capability)),
    ).toEqual([]);
    expect(majorKernelBundle().patch).toContain("name: '@major/dsh-kernel'");
    expect(DEFAULT_EXECUTION_BACKEND).toBe('lima');
  });

  it('uses the official bundle manifest and a resolvable local profile dependency', () => {
    expect(bundleManifest(majorKernelBundle()).dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(bundleManifest(majorKernelBundle()).main).toBe('./index.js');
    expect(
      profileManifest(majorWorkstationHeadlessProfile()).dependencies['@major/dsh-kernel'],
    ).toBe(MAJOR_KERNEL_LOCAL_SPEC);
  });
});

describe('DeepSeek Harness strangle install plan', () => {
  it('requires an attested pin and keeps live traffic on Lima', () => {
    const plan = buildHarnessInstallPlan(REPO_ROOT);
    expect(plan.pinVersion).toBe('0.1.0-rc.8');
    expect(plan.attestedCommit).toBe('141eb6fef83422698aef7a981029e843e8161534');
    expect(plan.executionBackend).toBe('lima');
    expect(plan.liveTrafficRemains).toBe('lima-cli-acp');
    expect(plan.profiles.map((profile) => profile.id)).toEqual([
      'major-workstation-web',
      'major-workstation-headless',
    ]);
    expect(plan.npmInstalls).toHaveLength(8);
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

  it('plans a Lima-hosted composed-profile smoke without switching live workers', () => {
    const task = buildHarnessShadowTask();
    expect(task.executionHost).toBe('lima');
    expect(task.liveTrafficRemains).toBe('lima-cli-acp');
    expect(task.optInDefault).toBe(false);
    expect(task.ready).toBe(false);
    expect(task.smoke.command).toContain('--dump-config');
    expect(task.smoke.command).not.toMatch(/latest|next|\^|~/);
  });

  it('dry-runs on the macOS system Bash without mutating the harness home', () => {
    const output = execFileSync(
      'bash',
      [resolve(REPO_ROOT, 'scripts/install-deepseek-harness-pin.sh'), '--dry-run'],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          MAJOR_DSH_HOME: resolve(REPO_ROOT, '.tmp-dsh-dry-run-must-not-exist'),
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
    expect(output).toContain('Major.app');
    expect(output).toContain('Live Major execution remains on Lima');
    expect(output).toContain('MAJOR_SESSION_HOST');
  });
});

describe('DeepSeek Harness shadow conformance', () => {
  it('passes the distribution contract without claiming live dsh or cleanup', () => {
    const report = runHarnessConformance(REPO_ROOT);
    expect(report.checks.filter((item) => !item.ok)).toEqual([]);
    expect(conformancePassed(report)).toBe(true);
    expect(report.phase).toBe('shadow');
    expect(report.executionBackend).toBe('lima');
    expect(report.liveDshInstalled).toBe(false);
    expect(report.ready).toBe(false);
    expect(CURRENT_HARNESS_MIGRATION_PHASE).toBe('shadow');
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
    expect(logs.join('\n')).toMatch(/phase: shadow/);
    expect(logs.join('\n')).toMatch(/live execution backend: lima/);
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
    expect(logs.join('\n')).toMatch(/live traffic: lima-cli-acp/);
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'shadow-task'])).toBe(true);
    expect(logs.join('\n')).toMatch(/opt-in default: false/);
    expect(logs.join('\n')).toMatch(/--dump-config/);
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'workstation-app'])).toBe(true);
    expect(logs.join('\n')).toMatch(/profile: major-workstation-web/);
    expect(logs.join('\n')).toMatch(/listen: 127.0.0.1:3080/);
  });
});
