import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveReusableAssets } from '../src/skills/assets.js';
import { runSkillCli } from '../src/skills/cli.js';
import { resolveSkills } from '../src/skills/resolver.js';
import { syncMajorSkills } from '../src/skills/sync.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;
const priorGbrainAssetIndex = process.env.MAJOR_GBRAIN_ASSET_INDEX;
const priorSkillsRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorSkillEvals = process.env.MAJOR_SKILLS_EVALS;

beforeEach(() => {
  delete process.env.MAJOR_SKILLS_REGISTRY;
  delete process.env.MAJOR_SKILLS_EVALS;
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
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function sourceCopy(prefix: string): string {
  const source = mkdtempSync(join(tmpdir(), prefix));
  roots.push(source);
  for (const directory of ['guidance', 'package', 'skills', 'evals', 'templates']) {
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
    expect(existsSync(join(current, 'guidance', 'skills-reconciliation-ledger.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'reusable-assets.registry.json'))).toBe(true);
    expect(existsSync(join(current, 'templates', 'project', 'GOAL_STATE.md'))).toBe(true);
    expect(
      existsSync(join(current, 'skills', 'internal', 'controller-bookkeeping', 'SKILL.md')),
    ).toBe(true);

    const marker = JSON.parse(readFileSync(join(current, 'bundle.json'), 'utf8')) as {
      version: number;
      sha: string;
    };
    expect(marker.version).toBe(1);
    expect(marker.sha).toMatch(/^[0-9a-f]{64}$/);

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
