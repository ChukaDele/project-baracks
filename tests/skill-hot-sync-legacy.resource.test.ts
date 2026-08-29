import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveReusableAssets } from '../src/skills/assets.js';
import { skillContentSha256 } from '../src/skills/catalog.js';
import { resolveSkills } from '../src/skills/resolver.js';
import { rollbackMajorSkills, syncMajorSkills } from '../src/skills/sync.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;
const priorSkillsRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorSkillEvals = process.env.MAJOR_SKILLS_EVALS;

beforeEach(() => {
  delete process.env.MAJOR_SKILLS_REGISTRY;
  delete process.env.MAJOR_SKILLS_EVALS;
});

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorSkillsRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorSkillsRegistry;
  if (priorSkillEvals === undefined) delete process.env.MAJOR_SKILLS_EVALS;
  else process.env.MAJOR_SKILLS_EVALS = priorSkillEvals;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function sourceCopy(): string {
  const source = mkdtempSync(join(tmpdir(), 'major-skill-rollback-source-'));
  roots.push(source);
  for (const directory of ['guidance', 'package', 'skills', 'evals', 'templates', 'adapters']) {
    cpSync(join(process.cwd(), directory), join(source, directory), { recursive: true });
  }
  return source;
}

function renamePromotedAsset(source: string, title: string): void {
  const path = join(source, 'guidance', 'reusable-assets.registry.json');
  const catalog = JSON.parse(readFileSync(path, 'utf8')) as {
    assets: Array<Record<string, unknown>>;
  };
  catalog.assets[0] = { ...catalog.assets[0], title };
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
}

function installLegacyBundle(home: string, source: string): string {
  const bundle = join(home, 'skill-bundles', 'legacy-v14');
  mkdirSync(join(bundle, 'guidance'), { recursive: true });
  mkdirSync(join(bundle, 'skills', 'internal'), { recursive: true });
  writeFileSync(
    join(bundle, 'guidance', 'skills.registry.json'),
    `${JSON.stringify(
      {
        version: 14,
        entries: [
          {
            id: 'presentation-storylining',
            source: 'major-internal',
            availability: 'all-projects',
            load: 'presentation-slide-deck-board-deck-strategy-deck',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  cpSync(
    join(source, 'skills', 'internal', 'presentation-storylining'),
    join(bundle, 'skills', 'internal', 'presentation-storylining'),
    { recursive: true },
  );
  const description = readFileSync(
    join(bundle, 'skills', 'internal', 'presentation-storylining', 'SKILL.md'),
    'utf8',
  )
    .match(/^---\n[\s\S]*?^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  writeFileSync(
    join(bundle, 'guidance', 'skills.catalog.json'),
    `${JSON.stringify(
      {
        version: 1,
        registryVersion: 14,
        entries: [
          {
            id: 'presentation-storylining',
            title: 'Presentation Storylining',
            description,
            aliases: [],
            availability: 'all-projects',
            source: 'major-internal',
            sourceKind: 'INTERNAL_DURABLE',
            registryVersion: 14,
            contentSha256: skillContentSha256(
              join(bundle, 'skills', 'internal', 'presentation-storylining'),
            ),
            triggers: ['presentation', 'slide', 'deck', 'board', 'deck', 'strategy', 'deck'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(bundle, 'bundle.json'),
    `${JSON.stringify({ version: 1, sha: 'a'.repeat(64), registryVersion: 14 }, null, 2)}\n`,
  );
  symlinkSync('legacy-v14', join(home, 'skill-bundles', 'current'));
  return bundle;
}

describe('legacy Skills Library rollback', () => {
  it('rejects and quarantines an incomplete legacy rollback bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-rollback-home-'));
    const source = sourceCopy();
    roots.push(home);
    process.env.MAJOR_HOME = home;
    installLegacyBundle(home, source);

    const activated = syncMajorSkills({ sourceRoot: source });
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(activated.bundleId);

    expect(() => rollbackMajorSkills()).toThrow(
      /recorded immediate predecessor .* failed validation/,
    );
    expect(readlinkSync(join(home, 'skill-bundles', 'current'))).toBe(activated.bundleId);
    expect(existsSync(join(home, 'skill-bundles', 'legacy-v14'))).toBe(false);
    expect(existsSync(join(home, 'dsh-harness'))).toBe(false);
  });

  it('rolls back skills and assets to the exact recorded predecessor bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-rollback-paired-home-'));
    const sourceA = sourceCopy();
    const sourceB = sourceCopy();
    roots.push(home);
    process.env.MAJOR_HOME = home;
    renamePromotedAsset(sourceB, 'Release B goal state template');

    const first = syncMajorSkills({ sourceRoot: sourceA });
    const second = syncMajorSkills({ sourceRoot: sourceB });
    expect(second.bundleId).not.toBe(first.bundleId);

    const rolledBack = rollbackMajorSkills();
    expect(rolledBack.bundleId).toBe(first.bundleId);
    expect(
      resolveSkills({
        task: 'Prepare an approved customer invoice and review receivables and payables.',
        limit: 6,
      }).skills.map((skill) => skill.id),
    ).toContain('ar-ap-invoice');
    expect(retrieveReusableAssets({ task: 'project goal state template' })).toMatchObject({
      catalog: 'available',
      decision: 'reuse',
      assets: [
        {
          id: 'project-goal-state-template',
          title: 'Project goal-state template',
          source: 'canonical-shared',
        },
      ],
    });
  });
});
