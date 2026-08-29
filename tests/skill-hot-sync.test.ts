import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveReusableAssets } from '../src/skills/assets.js';
import { runSkillCli } from '../src/skills/cli.js';
import { resolveSkills } from '../src/skills/resolver.js';
import { rollbackMajorSkills, syncMajorSkills } from '../src/skills/sync.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;
const priorGbrainAssetIndex = process.env.MAJOR_GBRAIN_ASSET_INDEX;
const priorSkillsRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorSkillEvals = process.env.MAJOR_SKILLS_EVALS;
const priorInjectedFailure = process.env.MAJOR_SKILL_SYNC_FAIL_AFTER;

beforeEach(() => {
  delete process.env.MAJOR_SKILLS_REGISTRY;
  delete process.env.MAJOR_SKILLS_EVALS;
  delete process.env.MAJOR_SKILL_SYNC_FAIL_AFTER;
});

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorGbrainAssetIndex === undefined) delete process.env.MAJOR_GBRAIN_ASSET_INDEX;
  else process.env.MAJOR_GBRAIN_ASSET_INDEX = priorGbrainAssetIndex;
  if (priorSkillsRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorSkillsRegistry;
  if (priorSkillEvals === undefined) delete process.env.MAJOR_SKILLS_EVALS;
  else process.env.MAJOR_SKILLS_EVALS = priorSkillEvals;
  if (priorInjectedFailure === undefined) delete process.env.MAJOR_SKILL_SYNC_FAIL_AFTER;
  else process.env.MAJOR_SKILL_SYNC_FAIL_AFTER = priorInjectedFailure;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function sourceCopy(prefix: string): string {
  const source = mkdtempSync(join(tmpdir(), prefix));
  roots.push(source);
  for (const directory of ['guidance', 'package', 'skills', 'evals', 'templates', 'adapters']) {
    cpSync(join(process.cwd(), directory), join(source, directory), { recursive: true });
  }
  return source;
}

describe('Major hot skill sync', () => {
  it('activates all current internal skills without a runtime reinstall', async () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-sync-home-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;

    const synced = await runSkillCli(['skill', 'sync', '--source', process.cwd(), '--json']);
    expect(synced).toBe(true);

    const current = join(home, 'skill-bundles', 'current');
    expect(existsSync(join(current, 'bundle.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'skills.registry.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'vendor-sources.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'skills-reconciliation-ledger.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'reusable-assets.registry.json'))).toBe(true);
    expect(existsSync(join(current, 'templates', 'project', 'GOAL_STATE.md'))).toBe(true);
    expect(existsSync(join(current, 'adapters', 'skills', 'CODEX.md'))).toBe(true);
    expect(
      existsSync(join(current, 'skills', 'internal', 'controller-bookkeeping', 'SKILL.md')),
    ).toBe(true);

    const marker = JSON.parse(readFileSync(join(current, 'bundle.json'), 'utf8')) as {
      version: number;
      sha: string;
    };
    expect(marker.version).toBe(1);
    expect(marker.sha).toMatch(/^[0-9a-f]{64}$/);
    const syncedRegistry = JSON.parse(
      readFileSync(join(current, 'guidance', 'skills.registry.json'), 'utf8'),
    ) as { entries: Array<{ id: string; disclosure?: string }> };
    expect(syncedRegistry.entries).toContainEqual(
      expect.objectContaining({ id: 'project-context-integrity', disclosure: 'hot' }),
    );
    const hostRoot = join(home, '..');
    const catalogEntries = syncedRegistry.entries.map((entry) => entry.id).sort();
    expect(
      readdirSync(join(hostRoot, '.codex', 'prompts', 'major'))
        .map((name) => name.replace(/\.md$/, ''))
        .sort(),
    ).toEqual(catalogEntries);
    expect(readFileSync(join(home, 'skills.catalog.json'), 'utf8')).toBe(
      readFileSync(join(current, 'guidance', 'skills.catalog.json'), 'utf8'),
    );

    const resolved = resolveSkills({
      task: 'Prepare an approved customer invoice, review receivables and payables, and draft a controlled follow-up.',
      limit: 6,
    });
    const accounting = resolved.skills.find((skill) => skill.id === 'ar-ap-invoice');
    expect(accounting).toBeDefined();
    expect(accounting?.path).toContain(
      '/skill-bundles/current/skills/internal/ar-ap-invoice/SKILL.md',
    );
  });

  it('is idempotent when the content-addressed destination is already active', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-idempotent-home-'));
    const source = sourceCopy('major-skill-idempotent-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;

    const first = syncMajorSkills({ sourceRoot: source });
    const markerBefore = readFileSync(join(first.activeBundle, 'bundle.json'), 'utf8');
    const second = syncMajorSkills({ sourceRoot: source });

    expect(second).toEqual(first);
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(first.bundleId);
    expect(readFileSync(join(first.activeBundle, 'bundle.json'), 'utf8')).toBe(markerBefore);
  });

  it('quarantines and rebuilds a corrupt retained bundle instead of activating it', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-corrupt-retained-home-'));
    const sourceA = sourceCopy('major-skill-corrupt-retained-a-');
    const sourceB = sourceCopy('major-skill-corrupt-retained-b-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceA, 'adapters', 'skills', 'CODEX.md'), 'trusted A rule\n');
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'trusted B rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    syncMajorSkills({ sourceRoot: sourceB });
    const corruptedEval = join(first.activeBundle, 'evals', 'skill-resolver', 'api.json');
    writeFileSync(corruptedEval, '{"skill":"api","should_trigger":[],"should_not_trigger":[]}\n');

    const reactivated = syncMajorSkills({ sourceRoot: sourceA });

    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(first.bundleId);
    expect(readFileSync(corruptedEval, 'utf8')).toBe(
      readFileSync(join(sourceA, 'evals', 'skill-resolver', 'api.json'), 'utf8'),
    );
    expect(
      readdirSync(join(home, 'skill-bundles')).some((name) =>
        name.startsWith(`.quarantine-${first.bundleId}-`),
      ),
    ).toBe(true);
    expect(reactivated.bundleId).toBe(first.bundleId);
  });

  it.each([
    ['adapter', 'adapters/skills/CODEX.md'],
    ['eval', 'evals/skill-resolver/api.json'],
    ['skill', 'skills/internal/api/SKILL.md'],
  ])('rejects a symlinked %s anywhere in authenticated bundle content', (_kind, relativePath) => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-symlink-home-'));
    const source = sourceCopy('major-skill-symlink-source-');
    const external = join(home, 'external-artifact');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(external, 'external\n');
    const artifact = join(source, relativePath);
    unlinkSync(artifact);
    symlinkSync(external, artifact);

    expect(() => syncMajorSkills({ sourceRoot: source })).toThrow(/symbolic links are forbidden/);
    expect(existsSync(join(home, 'skill-bundles', 'current'))).toBe(false);
  });

  it('requires an eval fixture for every canonical catalogue entry', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-eval-coverage-home-'));
    const source = sourceCopy('major-skill-eval-coverage-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    unlinkSync(join(source, 'evals', 'skill-resolver', 'vercel-react-best-practices.json'));

    expect(() => syncMajorSkills({ sourceRoot: source })).toThrow(
      /resolver eval coverage missing canonical skills: vercel-react-best-practices/,
    );
  });

  it('ignores active bundle artifact drift and a current link relocated outside skill-bundles', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-resolver-integrity-home-'));
    const source = sourceCopy('major-skill-resolver-integrity-source-');
    const external = mkdtempSync(join(tmpdir(), 'major-skill-relocated-bundle-'));
    roots.push(home, external);
    process.env.MAJOR_HOME = home;
    const synced = syncMajorSkills({ sourceRoot: source });
    const current = join(home, 'skill-bundles', 'current');

    writeFileSync(join(synced.activeBundle, 'adapters', 'skills', 'CODEX.md'), 'drifted\n');
    expect(
      resolveSkills({ task: 'Use skill-resolver for this task.', limit: 1 }).skills[0]?.path,
    ).not.toContain('/skill-bundles/current/');

    rmSync(current);
    cpSync(source, join(external, synced.bundleId), { recursive: true });
    cpSync(
      join(synced.activeBundle, 'bundle.json'),
      join(external, synced.bundleId, 'bundle.json'),
    );
    symlinkSync(join(external, synced.bundleId), current);
    expect(
      resolveSkills({ task: 'Use skill-resolver for this task.', limit: 1 }).skills[0]?.path,
    ).not.toContain('/skill-bundles/current/');
  });

  it('records the immediately active predecessor when reactivating, then rolls back to it', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-reactivation-rollback-home-'));
    const sourceA = sourceCopy('major-skill-reactivation-rollback-a-');
    const sourceB = sourceCopy('major-skill-reactivation-rollback-b-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceA, 'adapters', 'skills', 'CODEX.md'), 'bundle A rule\n');
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'bundle B rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    const second = syncMajorSkills({ sourceRoot: sourceB });

    syncMajorSkills({ sourceRoot: sourceA });
    const marker = JSON.parse(readFileSync(join(first.activeBundle, 'bundle.json'), 'utf8')) as {
      previousBundle?: string;
    };
    expect(marker.previousBundle).toBe(second.bundleId);

    const rolledBack = rollbackMajorSkills();
    expect(rolledBack.bundleId).toBe(second.bundleId);
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(second.bundleId);
  });

  it('fails closed when the active bundle has no recorded predecessor', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-no-predecessor-home-'));
    const source = sourceCopy('major-skill-no-predecessor-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    syncMajorSkills({ sourceRoot: source });

    expect(() => rollbackMajorSkills()).toThrow(/does not record an immediate predecessor/);
  });

  it('does not substitute another retained bundle for a corrupt recorded predecessor', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-corrupt-predecessor-home-'));
    const sourceA = sourceCopy('major-skill-corrupt-predecessor-a-');
    const sourceB = sourceCopy('major-skill-corrupt-predecessor-b-');
    const sourceC = sourceCopy('major-skill-corrupt-predecessor-c-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'bundle B rule\n');
    writeFileSync(join(sourceC, 'adapters', 'skills', 'CODEX.md'), 'bundle C rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    const second = syncMajorSkills({ sourceRoot: sourceB });
    const third = syncMajorSkills({ sourceRoot: sourceC });
    writeFileSync(join(second.activeBundle, 'bundle.json'), '{}\n');

    expect(() => rollbackMajorSkills()).toThrow(
      new RegExp(`recorded immediate predecessor ${second.bundleId} .* failed validation`),
    );
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(third.bundleId);
    expect(existsSync(first.activeBundle)).toBe(true);
  });

  it('does not substitute another retained bundle for a missing recorded predecessor', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-missing-predecessor-home-'));
    const sourceA = sourceCopy('major-skill-missing-predecessor-a-');
    const sourceB = sourceCopy('major-skill-missing-predecessor-b-');
    const sourceC = sourceCopy('major-skill-missing-predecessor-c-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'bundle B rule\n');
    writeFileSync(join(sourceC, 'adapters', 'skills', 'CODEX.md'), 'bundle C rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    const second = syncMajorSkills({ sourceRoot: sourceB });
    const third = syncMajorSkills({ sourceRoot: sourceC });
    rmSync(second.activeBundle, { recursive: true });

    expect(() => rollbackMajorSkills()).toThrow(
      new RegExp(`recorded immediate predecessor ${second.bundleId} is missing`),
    );
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(third.bundleId);
    expect(existsSync(first.activeBundle)).toBe(true);
  });

  it('rejects a changed referenced skill resource when the catalogue identity is stale', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-resource-identity-home-'));
    const source = sourceCopy('major-skill-resource-identity-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const resource = join(source, 'skills', 'internal', 'skill-resolver', 'references');
    mkdirSync(resource, { recursive: true });
    writeFileSync(join(resource, 'routing-policy.md'), 'changed after catalogue generation\n');
    expect(() => syncMajorSkills({ sourceRoot: source })).toThrow(
      /generated skill catalog does not match the canonical registry/,
    );
    expect(existsSync(join(home, 'skill-bundles', 'current'))).toBe(false);
  });

  it('rejects aliases that collide with another canonical id', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-alias-collision-home-'));
    const source = sourceCopy('major-skill-alias-collision-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const registryPath = join(source, 'guidance', 'skills.registry.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      entries: Array<{ id: string; aliases?: string[] }>;
    };
    registry.entries[0]!.aliases = [registry.entries[1]!.id];
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    expect(() => syncMajorSkills({ sourceRoot: source })).toThrow(/duplicate skill id or alias/);
  });

  it.each([
    ['id', '../escape'],
    ['alias', '../../escape'],
    ['id', 'nested/escape'],
  ])('rejects an unsafe registry %s before host path interpolation', (field, unsafe) => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-slug-home-'));
    const source = sourceCopy('major-skill-slug-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const registryPath = join(source, 'guidance', 'skills.registry.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      entries: Array<{ id: string; aliases?: string[] }>;
    };
    if (field === 'id') registry.entries[0]!.id = unsafe;
    else registry.entries[0]!.aliases = [unsafe];
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    expect(() => syncMajorSkills({ sourceRoot: source })).toThrow(/safe canonical slug/);
    expect(existsSync(join(home, 'skill-bundles'))).toBe(false);
    expect(existsSync(join(home, '..', 'escape.md'))).toBe(false);
  });

  it('restores the prior bundle and every host artifact after an injected activation failure', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-atomic-home-'));
    const sourceA = sourceCopy('major-skill-atomic-source-a-');
    const sourceB = sourceCopy('major-skill-atomic-source-b-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceA, 'adapters', 'skills', 'CODEX.md'), 'bundle A rule\n');
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'bundle B rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    const hostRoot = join(home, '..');
    const catalogBefore = readFileSync(join(home, 'skills.catalog.json'), 'utf8');
    process.env.MAJOR_SKILL_SYNC_FAIL_AFTER = '4';

    expect(() => syncMajorSkills({ sourceRoot: sourceB })).toThrow(
      /injected skill activation failure/,
    );
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(first.bundleId);
    expect(readFileSync(join(home, 'skills.catalog.json'), 'utf8')).toBe(catalogBefore);
    expect(readFileSync(join(hostRoot, '.codex', 'MAJOR_SKILLS.md'), 'utf8')).toBe(
      'bundle A rule\n',
    );
    expect(
      readdirSync(join(hostRoot, '.codex', 'prompts', 'major')).every((name) =>
        name.endsWith('.md'),
      ),
    ).toBe(true);
  });

  it('rebuilds matching host rules, catalogue, and namespaced commands on rollback', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-rollback-artifacts-home-'));
    const sourceA = sourceCopy('major-skill-rollback-artifacts-a-');
    const sourceB = sourceCopy('major-skill-rollback-artifacts-b-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    writeFileSync(join(sourceA, 'adapters', 'skills', 'CODEX.md'), 'bundle A rule\n');
    writeFileSync(join(sourceB, 'adapters', 'skills', 'CODEX.md'), 'bundle B rule\n');
    const first = syncMajorSkills({ sourceRoot: sourceA });
    syncMajorSkills({ sourceRoot: sourceB });

    const rolledBack = rollbackMajorSkills();
    const hostRoot = join(home, '..');
    expect(rolledBack.bundleId).toBe(first.bundleId);
    expect(readFileSync(join(hostRoot, '.codex', 'MAJOR_SKILLS.md'), 'utf8')).toBe(
      'bundle A rule\n',
    );
    expect(readFileSync(join(home, 'skills.catalog.json'), 'utf8')).toBe(
      readFileSync(join(rolledBack.activeBundle, 'guidance', 'skills.catalog.json'), 'utf8'),
    );
    const ids = JSON.parse(readFileSync(join(home, 'skills.catalog.json'), 'utf8')) as {
      entries: Array<{ id: string }>;
    };
    expect(readdirSync(join(hostRoot, '.codex', 'prompts', 'major')).sort()).toEqual(
      ids.entries.map(({ id }) => `${id}.md`).sort(),
    );
  });

  it('returns a project-local asset before the metadata index', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-assets-home-'));
    const source = sourceCopy('major-skill-assets-source-');
    const project = mkdtempSync(join(tmpdir(), 'major-skill-assets-project-'));
    roots.push(home, project);
    process.env.MAJOR_HOME = home;
    syncMajorSkills({ sourceRoot: source });

    cpSync(join(source, 'templates', 'project'), join(project, 'templates', 'project'), {
      recursive: true,
    });
    const local = JSON.parse(
      readFileSync(join(source, 'guidance', 'reusable-assets.registry.json'), 'utf8'),
    ) as { version: number; assets: Record<string, unknown>[] };
    const localAsset = {
      ...local.assets[0],
      id: 'local-project-goal-state-template',
      title: 'Local project goal state template',
      scope: 'project-local',
      provenance: {
        ...(local.assets[0]!.provenance as Record<string, unknown>),
        sourceProject: project,
      },
    };
    mkdirSync(join(project, '.major'), { recursive: true });
    writeFileSync(
      join(project, '.major', 'reusable-assets.registry.json'),
      `${JSON.stringify({ version: local.version, assets: [localAsset] }, null, 2)}\n`,
    );

    const result = retrieveReusableAssets({ task: 'update the project goal state', cwd: project });
    expect(result.decision).toBe('reuse');
    expect(result.searched).toEqual(['project-local']);
    expect(result.assets[0]).toMatchObject({
      id: 'local-project-goal-state-template',
      source: 'project-local',
    });
  });

  it('queries a configured metadata-only GBrain index before canonical shared assets', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-gbrain-home-'));
    const source = sourceCopy('major-skill-gbrain-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    process.env.MAJOR_GBRAIN_ASSET_INDEX = join(
      source,
      'guidance',
      'gbrain-reusable-assets.index.json',
    );
    syncMajorSkills({ sourceRoot: source });

    const result = retrieveReusableAssets({ task: 'project goal state template' });
    expect(result.decision).toBe('reuse');
    expect(result.searched).toEqual(['gbrain-org-index']);
    expect(result.assets[0]).toMatchObject({
      id: 'project-goal-state-template',
      source: 'gbrain-org-index',
    });
  });

  it('returns a historical candidate for inspection before recommending a new build', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-candidate-home-'));
    const source = sourceCopy('major-skill-candidate-source-');
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const candidatesPath = join(source, 'guidance', 'reusable-assets.candidates.json');
    const catalog = JSON.parse(
      readFileSync(join(source, 'guidance', 'reusable-assets.registry.json'), 'utf8'),
    ) as { assets: Record<string, unknown>[] };
    writeFileSync(
      candidatesPath,
      `${JSON.stringify(
        {
          version: 1,
          assets: [
            {
              ...catalog.assets[0],
              id: 'historical-ledger-parser',
              title: 'Historical ledger parser',
              summary: 'A recovered candidate for parsing a historical ledger export.',
              tags: ['historical', 'ledger', 'parser'],
              lifecycle: 'REUSE_CANDIDATE',
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    syncMajorSkills({ sourceRoot: source });

    const result = retrieveReusableAssets({ task: 'recover a historical ledger parser' });
    expect(result.decision).toBe('inspect-historical-candidates');
    expect(result.searched).toEqual([
      'gbrain-org-index',
      'canonical-shared',
      'historical-candidate',
    ]);
    expect(result.assets[0]).toMatchObject({
      id: 'historical-ledger-parser',
      lifecycle: 'REUSE_CANDIDATE',
      source: 'historical-candidate',
    });
  });
});
