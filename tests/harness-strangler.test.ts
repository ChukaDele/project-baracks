import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_REUSE, missingRetainedCapabilities } from '../src/harness/capabilities.js';
import { runHarnessCli } from '../src/harness/cli.js';
import {
  CURRENT_HARNESS_MIGRATION_PHASE,
  DEFAULT_EXECUTION_BACKEND,
  MAJOR_KERNEL_LOCAL_SPEC,
  bundleManifest,
  majorKernelBundle,
  majorWorkstationHeadlessProfile,
  majorWorkstationWebProfile,
  profileManifest,
} from '../src/harness/composition.js';
import { conformancePassed, runHarnessConformance } from '../src/harness/conformance.js';
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
      '@major/dsh-kernel',
    ]);
    expect(headless.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
      '@major/dsh-kernel',
    ]);
    expect(web.autoStartDaemon).toBe(false);
    expect(headless.attachRufloGlobally).toBe(false);
    expect(web.listen).toBe('127.0.0.1');
  });

  it('preserves every KEEP Major capability outside dsh during shadow', () => {
    expect(
      missingRetainedCapabilities(CAPABILITY_REUSE.map((record) => record.capability)),
    ).toEqual([]);
    expect(majorKernelBundle().patch).toBe('[]\n');
    expect(DEFAULT_EXECUTION_BACKEND).toBe('lima');
  });

  it('uses the official bundle manifest and a resolvable local profile dependency', () => {
    expect(bundleManifest(majorKernelBundle()).dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(
      profileManifest(majorWorkstationHeadlessProfile()).dependencies['@major/dsh-kernel'],
    ).toBe(MAJOR_KERNEL_LOCAL_SPEC);
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
      '@deepseek-ai/dsh-base -> @deepseek-ai/dsh-headless -> @major/dsh-kernel',
    );
    logs.length = 0;
    expect(await runHarnessCli(['harness', 'conformance'])).toBe(true);
    expect(logs.join('\n')).toMatch(/PASS pin.exact/);
  });
});
