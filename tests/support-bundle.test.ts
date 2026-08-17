import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDoctor } from '../src/doctor/doctor.js';
import { buildSupportBundle } from '../src/doctor/support-bundle.js';
import { MockProvider } from '../src/providers/mock.js';
import { model } from './helpers.js';

function fixtureMajorHome(): string {
  return mkdtempSync(join(tmpdir(), 'major-support-bundle-fixture-'));
}

async function fixtureReport(providers = [new MockProvider({ name: 'claude-code' })]) {
  return runDoctor({
    providers,
    configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
    resolve: () => '/usr/bin/tool',
  });
}

describe('major support-bundle', () => {
  it('omits raw credential/secret content even when it appears in an upstream field', async () => {
    const report = await fixtureReport([
      new MockProvider({
        name: 'claude-code',
        installed: true,
        authenticated: true,
        // A pathological provider surfacing a live secret in its model ref
        // must not survive into a bundle a user pastes into a support
        // ticket — this proves the defense-in-depth redaction pass reaches
        // the providers/models sections, not just that curated fields happen
        // to be clean.
        models: [model({ modelRef: 'sk-liveSecretTokenAbcdef1234567890' })],
      }),
    ]);
    const home = fixtureMajorHome();
    const bundle = buildSupportBundle(report, { majorHome: home });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('sk-liveSecretTokenAbcdef1234567890');
    expect(serialized).toContain('[REDACTED]');
  });

  it('strips a GitHub-token-shaped string even if it leaked into a free-text field upstream', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome();
    writeFileSync(
      join(home, 'installed-release.json'),
      JSON.stringify({
        version: '0.5.2',
        sha: 'a'.repeat(40),
        // A branch name is free text an installer could theoretically copy
        // verbatim from an environment variable; prove it still comes out
        // redacted rather than assuming branch names are always safe.
        branch: 'ghp_liveGithubTokenAbcdefghijklmnopqrst',
        installedAt: 't',
        releaseGate: 'passed',
      }),
    );
    const bundle = buildSupportBundle(report, { majorHome: home });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('ghp_liveGithubTokenAbcdefghijklmnopqrst');
    expect(bundle.major.installedBranch).toBe('[REDACTED]');
  });

  it('reports release integrity from installed-release.json without inventing a live re-verification', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome();
    writeFileSync(
      join(home, 'installed-release.json'),
      JSON.stringify({
        version: '0.5.2',
        sha: 'a'.repeat(40),
        branch: 'main',
        installedAt: '2026-08-01T00:00:00.000Z',
        releaseGate: 'passed',
      }),
    );
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.major).toEqual({
      version: '0.5.2',
      installedSha: 'a'.repeat(40),
      installedBranch: 'main',
      installedAt: '2026-08-01T00:00:00.000Z',
      releaseGateAtInstall: 'passed',
    });
  });

  it('falls back to the local package.json version when no release has been installed', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome(); // no installed-release.json written
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.major.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bundle.major.installedSha).toBeNull();
  });

  it('includes only non-ok checks as error categories, each already redacted', async () => {
    const report = await fixtureReport([
      new MockProvider({ name: 'claude-code', installed: false, authenticated: false }),
    ]);
    const home = fixtureMajorHome();
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.errorChecks.length).toBeGreaterThan(0);
    expect(bundle.errorChecks.every((c) => c.status !== 'ok')).toBe(true);
    expect(bundle.errorChecks.some((c) => c.name === 'provider:claude-code')).toBe(true);
  });

  it('surfaces core readiness, provider statuses and live-execution state', async () => {
    const report = await fixtureReport([
      new MockProvider({
        name: 'claude-code',
        installed: true,
        authenticated: true,
        models: [model({ modelRef: 'sonnet' })],
      }),
    ]);
    const home = fixtureMajorHome();
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.core.ready).toBe(report.core.ready);
    expect(bundle.providers).toEqual(
      report.providerReadiness.map((p) => ({
        provider: p.provider,
        state: p.state,
        detail: p.detail,
      })),
    );
    expect(bundle.liveExecution.ready).toBe(report.liveExecution.ready);
    expect(bundle.multiProviderReady).toBe(report.multiProviderReady);
  });

  it('surfaces only version/sha/timestamp from recent install history, most-recent-last, bounded to 10', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome();
    const lines = Array.from({ length: 15 }, (_, i) =>
      JSON.stringify({
        version: `0.5.${i}`,
        sha: String(i).padStart(40, '0'),
        installedAt: `t${i}`,
      }),
    );
    writeFileSync(join(home, 'install-history.jsonl'), lines.join('\n') + '\n');
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.installHistory).toHaveLength(10);
    expect(bundle.installHistory[0]?.version).toBe('0.5.5');
    expect(bundle.installHistory.at(-1)?.version).toBe('0.5.14');
  });

  it('drops corrupt install-history lines rather than surfacing raw unparsed bytes', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome();
    writeFileSync(
      join(home, 'install-history.jsonl'),
      'not json\n' +
        JSON.stringify({ version: '0.5.2', sha: 'a'.repeat(40), installedAt: 't' }) +
        '\n',
    );
    const bundle = buildSupportBundle(report, { majorHome: home });
    expect(bundle.installHistory).toEqual([
      { version: '0.5.2', sha: 'a'.repeat(40), installedAt: 't' },
    ]);
  });

  it('reports no worker instance when execution.json is absent rather than throwing', async () => {
    const report = await fixtureReport();
    const home = fixtureMajorHome();
    const bundle = buildSupportBundle(report, {
      majorHome: home,
      now: () => new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(bundle.worker).toEqual({ instance: null, isolationScope: null });
    expect(bundle.generatedAt).toBe('2026-08-16T00:00:00.000Z');
  });
});
