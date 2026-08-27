import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { majorHome } from '../supervisor/state.js';

const lifecycleSchema = z.enum([
  'LOCAL',
  'REUSE_CANDIDATE',
  'EVALUATED',
  'PROMOTED',
  'MONITORED',
  'UPDATED',
  'DEPRECATED',
]);

const assetSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  locator: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  aliases: z.array(z.string().min(1)).default([]),
  lifecycle: lifecycleSchema,
  provenance: z.object({
    sourceProject: z.string().min(1),
    sourceVersion: z.string().min(1),
    owner: z.string().min(1),
    license: z.string().min(1),
    lineage: z.array(z.string().min(1)).min(1),
  }),
  compatibility: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1)),
  evidence: z.object({
    tests: z.array(z.string().min(1)),
    latestVerifiedVersion: z.string().min(1),
  }),
  limitations: z.array(z.string().min(1)),
  scope: z.enum(['shared', 'project-local']),
  usage: z.object({
    successfulProjects: z.number().int().nonnegative(),
    latestVerifiedVersion: z.string().min(1),
    incidents: z.number().int().nonnegative(),
  }),
  wrapperPolicy: z.string().min(1),
  candidateNarrative: z.string().min(1).optional(),
});

const catalogSchema = z.object({
  version: z.number().int().positive(),
  assets: z.array(assetSchema),
});

const metadataAssetSchema = assetSchema.pick({
  id: true,
  kind: true,
  title: true,
  summary: true,
  locator: true,
  tags: true,
  lifecycle: true,
  scope: true,
  compatibility: true,
  limitations: true,
}).extend({
  owner: z.string().min(1),
  latestVerifiedVersion: z.string().min(1),
});

const gbrainIndexSchema = z.object({
  version: z.number().int().positive(),
  kind: z.literal('gbrain-reusable-asset-metadata'),
  sourceRegistry: z.string().min(1),
  contentPolicy: z.literal('metadata-only; implementation bodies remain at the canonical locator'),
  assets: z.array(metadataAssetSchema),
});

export type ReusableAsset = z.infer<typeof assetSchema>;
export type AssetLifecycle = z.infer<typeof lifecycleSchema>;

export interface ReusableAssetMatch extends ReusableAsset {
  score: number;
  source:
    | 'project-local'
    | 'gbrain-org-index'
    | 'canonical-shared'
    | 'historical-candidate'
    | 'mature-prior-art';
}

export interface ReusableAssetDiscovery {
  task: string;
  searched: ReusableAssetMatch['source'][];
  assets: ReusableAssetMatch[];
  decision: 'reuse' | 'inspect-historical-candidates' | 'evaluate-mature-prior-art' | 'minimum-build';
  catalog: 'available' | 'unavailable-in-active-skills-bundle';
}

function runtimeRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/**
 * An older retained Skills Library bundle remains authoritative after a
 * rollback. Its marker accepts both the original Git-SHA form and the newer
 * content-addressed form. Asset support is assessed separately: a v14 bundle
 * predates the asset catalog and must never fall through to newer source.
 */
function activeHotBundleRoot(): string | undefined {
  const root = join(majorHome(), 'skill-bundles', 'current');
  const marker = join(root, 'bundle.json');
  const registry = join(root, 'guidance', 'skills.registry.json');
  const internal = join(root, 'skills', 'internal');
  if (!existsSync(marker) || !existsSync(registry) || !existsSync(internal)) return undefined;
  try {
    const bundle = JSON.parse(readFileSync(marker, 'utf8')) as { version?: unknown; sha?: unknown };
    const hot = JSON.parse(readFileSync(registry, 'utf8')) as { version?: unknown };
    if (
      bundle.version !== 1 ||
      typeof bundle.sha !== 'string' ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(bundle.sha) ||
      !Number.isInteger(hot.version) ||
      Number(hot.version) < 1
    ) {
      return undefined;
    }
    return root;
  } catch {
    return undefined;
  }
}

function assetCatalogRoot(): { root?: string; catalog: ReusableAssetDiscovery['catalog'] } {
  const active = activeHotBundleRoot();
  if (!active) return { root: runtimeRoot(), catalog: 'available' };
  return existsSync(join(active, 'guidance', 'reusable-assets.registry.json'))
    ? { root: active, catalog: 'available' }
    : { catalog: 'unavailable-in-active-skills-bundle' };
}

function words(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  );
}

function scoreAsset(asset: Pick<ReusableAsset, 'id' | 'kind' | 'title' | 'summary' | 'tags' | 'aliases'>, task: string): number {
  const taskWords = words(task);
  const terms = words([asset.id, asset.kind, asset.title, asset.summary, ...asset.tags, ...asset.aliases].join(' '));
  return [...terms].filter((term) => taskWords.has(term)).length;
}

function readCatalog(root: string, path = 'guidance/reusable-assets.registry.json'): ReusableAsset[] {
  const catalog = catalogSchema.parse(JSON.parse(readFileSync(join(root, path), 'utf8')));
  const ids = catalog.assets.map((asset) => asset.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate reusable asset ids');
  return catalog.assets;
}

function toMatch(
  asset: ReusableAsset,
  root: string,
  source: ReusableAssetMatch['source'],
  task: string,
): ReusableAssetMatch | undefined {
  const absolute = resolve(root, asset.locator);
  if (!inside(resolve(root), absolute) || !existsSync(absolute)) return undefined;
  const canonicalRoot = realpathSync(root);
  if (!inside(canonicalRoot, realpathSync(absolute))) return undefined;
  const score = scoreAsset(asset, task);
  return score > 0 ? { ...asset, score, source } : undefined;
}

function matches(
  assets: ReusableAsset[],
  root: string,
  source: ReusableAssetMatch['source'],
  task: string,
  limit: number,
  eligibleLifecycles = new Set<AssetLifecycle>(['PROMOTED', 'MONITORED', 'UPDATED']),
): ReusableAssetMatch[] {
  return assets
    .filter((asset) => eligibleLifecycles.has(asset.lifecycle))
    .map((asset) => toMatch(asset, root, source, task))
    .filter((asset): asset is ReusableAssetMatch => Boolean(asset))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function projectLocalRoot(cwd: string): string | undefined {
  const path = join(cwd, '.major', 'reusable-assets.registry.json');
  return existsSync(path) ? dirname(dirname(path)) : undefined;
}

function gbrainMatches(root: string, task: string, limit: number): ReusableAssetMatch[] {
  const configured = process.env.MAJOR_GBRAIN_ASSET_INDEX;
  if (!configured) return [];
  const path = resolve(configured);
  if (!existsSync(path)) return [];
  const index = gbrainIndexSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const full = new Map(readCatalog(root).map((asset) => [asset.id, asset]));
  return index.assets
    .map((metadata) => full.get(metadata.id))
    .filter((asset): asset is ReusableAsset => Boolean(asset))
    .map((asset) => toMatch(asset, root, 'gbrain-org-index', task))
    .filter((asset): asset is ReusableAssetMatch => Boolean(asset))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);
}

/**
 * Retrieval is intentionally metadata-only. Implementations remain at their
 * canonical locator until a policy-governed consumer chooses to reuse them.
 */
export function retrieveReusableAssets(input: {
  task: string;
  cwd?: string;
  limit?: number;
}): ReusableAssetDiscovery {
  const task = input.task.trim();
  if (!task) throw new Error('reusable asset retrieval task must not be empty');
  const cwd = resolve(input.cwd ?? process.cwd());
  const limit = input.limit ?? 6;
  const searched: ReusableAssetMatch['source'][] = [];

  const local = projectLocalRoot(cwd);
  if (local) {
    searched.push('project-local');
    const found = matches(readCatalog(local, '.major/reusable-assets.registry.json'), local, 'project-local', task, limit);
    if (found.length) return { task, searched, assets: found, decision: 'reuse', catalog: 'available' };
  }

  const catalogRoot = assetCatalogRoot();
  if (!catalogRoot.root) {
    searched.push('gbrain-org-index', 'canonical-shared', 'historical-candidate', 'mature-prior-art');
    return { task, searched, assets: [], decision: 'minimum-build', catalog: catalogRoot.catalog };
  }
  const root = catalogRoot.root;
  searched.push('gbrain-org-index');
  const gbrain = gbrainMatches(root, task, limit);
  if (gbrain.length) return { task, searched, assets: gbrain, decision: 'reuse', catalog: catalogRoot.catalog };

  searched.push('canonical-shared');
  const canonical = matches(readCatalog(root), root, 'canonical-shared', task, limit);
  if (canonical.length) return { task, searched, assets: canonical, decision: 'reuse', catalog: catalogRoot.catalog };

  searched.push('historical-candidate');
  const candidates = join(root, 'guidance', 'reusable-assets.candidates.json');
  if (existsSync(candidates)) {
    const historical = matches(
      readCatalog(root, 'guidance/reusable-assets.candidates.json'),
      root,
      'historical-candidate',
      task,
      limit,
      new Set<AssetLifecycle>(['REUSE_CANDIDATE', 'EVALUATED']),
    );
    if (historical.length) {
      return {
        task,
        searched,
        assets: historical,
        decision: 'inspect-historical-candidates',
        catalog: catalogRoot.catalog,
      };
    }
  }

  searched.push('mature-prior-art');
  return {
    task,
    searched,
    assets: [],
    decision: /integration|adapter|framework|library|platform|provider/i.test(task)
      ? 'evaluate-mature-prior-art'
      : 'minimum-build',
    catalog: catalogRoot.catalog,
  };
}

export function formatReusableAssetDiscovery(input: { task: string; cwd: string }): string {
  const result = retrieveReusableAssets(input);
  const found = result.assets.length
    ? result.assets
        .map(
          (asset) =>
            `- ${asset.id} (${asset.kind}, ${asset.source})\n  locator: ${asset.locator}\n  wrapper: ${asset.wrapperPolicy}`,
        )
        .join('\n')
    : '- no matching internal asset';
  return `REUSABLE ASSET DISCOVERY (required before implementation)
Order: project-local -> GBrain organisation index -> canonical shared assets -> historical candidates -> mature prior art -> minimum build.
Task: ${result.task}
Decision: ${result.decision}
Matches are metadata only. Read a locator only after confirming scope, compatibility, provenance and project policy.
${found}
On successful work: classify repeatable procedure -> skill workflow; implementation -> reusable asset candidate; decision -> ADR/GBrain metadata; failure/fix -> regression lesson.`;
}

export interface AssetCandidateInput {
  id: string;
  kind: string;
  summary: string;
  locator: string;
  tags: string[];
  scope: 'shared' | 'project-local';
  sourceProject: string;
  narrative: string;
}

/** Record a project-local candidate. Promotion to the shared registry remains explicit and reviewed. */
export function observeReusableAssetCandidate(input: AssetCandidateInput): ReusableAsset {
  const projectRoot = resolve(input.sourceProject);
  const locator = assetPath(projectRoot, { locator: input.locator });
  const target = join(projectRoot, locator);
  if (!locator || !existsSync(target) || !lstatSync(target).isFile()) {
    throw new Error('reusable asset candidate locator is unavailable');
  }
  const sourceVersion = `sha256:${createHash('sha256').update(readFileSync(target)).digest('hex')}`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)) {
    throw new Error('reusable asset candidate id is invalid');
  }
  const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!input.kind.trim() || !input.summary.trim() || tags.length === 0) {
    throw new Error('reusable asset candidate metadata is incomplete');
  }
  const path = join(projectRoot, '.major', 'reusable-assets.registry.json');
  const existing = existsSync(path)
    ? readCatalog(projectRoot, '.major/reusable-assets.registry.json')
    : [];
  const asset: ReusableAsset = {
    id: input.id,
    kind: input.kind,
    title: input.id.replace(/-/g, ' '),
    summary: input.summary,
    locator,
    tags,
    aliases: [],
    lifecycle: 'REUSE_CANDIDATE',
    provenance: {
      sourceProject: input.sourceProject,
      sourceVersion,
      owner: 'project',
      license: 'project-local',
      lineage: [locator],
    },
    compatibility: [],
    dependencies: [],
    evidence: { tests: [], latestVerifiedVersion: sourceVersion },
    limitations: ['Candidate only. Remove project-specific assumptions before shared promotion.'],
    candidateNarrative: input.narrative,
    // Candidate metadata is local until an explicit reviewed promotion.
    scope: 'project-local',
    usage: { successfulProjects: 1, latestVerifiedVersion: sourceVersion, incidents: 0 },
    wrapperPolicy: 'Keep client and domain composition in the source project wrapper.',
  };
  const assets = [...existing.filter((candidate) => candidate.id !== asset.id), asset];
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, assets }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  return asset;
}

export function assetPath(root: string, asset: Pick<ReusableAsset, 'locator'>): string {
  const absolute = resolve(root, asset.locator);
  if (!inside(resolve(root), absolute)) throw new Error('asset locator escapes canonical root');
  if (existsSync(absolute) && !inside(realpathSync(root), realpathSync(absolute))) {
    throw new Error('asset locator escapes canonical root through a symlink');
  }
  return relative(root, absolute);
}
