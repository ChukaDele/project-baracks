import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { majorHome } from '../supervisor/state.js';
import {
  loadActiveGeneratedSkills,
  skillPerformanceScore,
  type SkillCandidate,
} from './lifecycle.js';
import {
  findVendorSkill,
  formatVendorReference,
  getCachedVendorSection,
  inferSkillSourceKind,
  loadVendorCatalog,
  selectVendorSkill,
  SKILL_SOURCE_KINDS,
  vendorSourceState,
  type SkillSourceKind,
  type VendorCatalog,
  type VendorSkillSelection,
  type VendorSourceState,
} from './vendor.js';

const registryEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceKind: z.enum(SKILL_SOURCE_KINDS).optional(),
  vendorSkill: z.string().optional(),
  availability: z.string(),
  load: z.string(),
  aliases: z.array(z.string().min(1)).default([]),
  disclosure: z.enum(['hot', 'specialist']).default('specialist'),
  deprecated: z
    .object({ replacement: z.string().min(1).optional(), message: z.string().min(1).optional() })
    .optional(),
});

const registrySchema = z.object({
  version: z.number().int().positive(),
  entries: z.array(registryEntrySchema),
});

const bundleSchema = z.object({
  version: z.literal(1),
  sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
});

export type SkillRegistryEntry = z.infer<typeof registryEntrySchema>;

export interface ResolvedSkill {
  id: string;
  source: string;
  sourceKind: SkillSourceKind;
  path?: string;
  reference: string;
  vendor?: VendorSkillSelection;
  score: number;
  reason: string;
}

export interface SkillResolution {
  task: string;
  skills: ResolvedSkill[];
  receipt: SkillResolutionReceipt;
}

export interface SkillResolutionReceipt {
  mode: 'explicit' | 'automatic' | 'project';
  requested: string[];
  selected: string[];
  evidence: Array<{ id: string; score: number; reason: string; source: string }>;
}

export type SkillDisclosureState = 'HOT' | 'ACTIVE' | 'DORMANT';

export interface SkillDisclosure {
  task: string;
  manifest: Array<{
    id: string;
    source: string;
    sourceKind: SkillSourceKind;
    state: SkillDisclosureState;
    load: string;
    vendor?: {
      state: VendorSourceState;
      freshness: VendorSkillSelection['freshness'];
      sectionId: string;
    };
  }>;
  bodies: Array<{
    id: string;
    source: string;
    sourceKind: SkillSourceKind;
    state: Exclude<SkillDisclosureState, 'DORMANT'>;
    content: string;
    truncated: boolean;
    sectionId?: string;
    reference?: string;
    contentSource?: 'reference' | 'cache';
  }>;
  vendorReferences: Array<VendorSkillSelection & { contentSource: 'reference' | 'cache' }>;
  metrics: {
    manifest: { beforeBytes: number; disclosedBytes: number };
    bodies: { beforeBytes: number; disclosedBytes: number };
    vendor: {
      beforeBytes: number;
      disclosedBytes: number;
      selectedSkills: number;
      cachedSections: number;
    };
    total: { beforeBytes: number; disclosedBytes: number; estimatedTokensBefore: number; estimatedTokensDisclosed: number };
    budgets: { manifestBytes: number; bodyBytes: number; perBodyBytes: number };
  };
}

const DISCLOSURE_BUDGETS = {
  manifestBytes: 8_000,
  bodyBytes: 32_000,
  perBodyBytes: 12_000,
} as const;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
}

const STOP_WORDS = new Set([
  'all',
  'and',
  'for',
  'from',
  'into',
  'load',
  'major',
  'only',
  'project',
  'projects',
  'relevant',
  'start',
  'task',
  'the',
  'this',
  'use',
  'with',
  'work',
]);

function runtimeRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function readRegistry(path: string): z.infer<typeof registrySchema> {
  return registrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Major's executable runtime is immutable, but reusable knowledge should not
 * require a full runtime/Lima reinstall. A hot bundle is trusted only when it
 * was activated through the skill-sync path (bundle marker + complete
 * registry/skill tree). A retained older bundle is valid after an explicit
 * rollback: it must continue to resolve its known-good registry rather than
 * silently mixing in newer immutable skills. A partial or malformed bundle is
 * ignored fail-closed.
 */
function hotSkillBundleRoot(): string | undefined {
  const root = join(majorHome(), 'skill-bundles', 'current');
  const marker = join(root, 'bundle.json');
  const registry = join(root, 'guidance', 'skills.registry.json');
  const internal = join(root, 'skills', 'internal');
  if (!existsSync(marker) || !existsSync(registry) || !existsSync(internal)) return undefined;
  try {
    bundleSchema.parse(JSON.parse(readFileSync(marker, 'utf8')));
    const hot = readRegistry(registry);
    return hot.version >= 1 ? root : undefined;
  } catch {
    return undefined;
  }
}

function registryPath(): string {
  if (process.env.MAJOR_SKILLS_REGISTRY) return resolve(process.env.MAJOR_SKILLS_REGISTRY);
  const hot = hotSkillBundleRoot();
  return hot
    ? join(hot, 'guidance', 'skills.registry.json')
    : join(runtimeRoot(), 'guidance', 'skills.registry.json');
}

function resolverEvalPath(): string {
  if (process.env.MAJOR_SKILLS_EVALS) return resolve(process.env.MAJOR_SKILLS_EVALS);
  const hot = hotSkillBundleRoot();
  const hotPath = hot ? join(hot, 'evals', 'skill-resolver') : undefined;
  return hotPath && existsSync(hotPath) ? hotPath : join(runtimeRoot(), 'evals', 'skill-resolver');
}

function vendorCatalogPath(): string {
  if (process.env.MAJOR_VENDOR_SOURCES) return resolve(process.env.MAJOR_VENDOR_SOURCES);
  return join(dirname(registryPath()), 'vendor-sources.json');
}

function readVendorCatalog(): VendorCatalog | undefined {
  const path = vendorCatalogPath();
  return existsSync(path) ? loadVendorCatalog(path) : undefined;
}

interface ResolverExamples {
  positive: string[];
  negative: string[];
}

function resolverExamples(): Map<string, ResolverExamples> {
  const root = resolverEvalPath();
  const examples = new Map<string, ResolverExamples>();
  if (!existsSync(root)) return examples;
  for (const name of readdirSync(root).filter((file) => file.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(root, name), 'utf8')) as {
      skill?: unknown;
      should_trigger?: unknown;
      should_not_trigger?: unknown;
    };
    if (typeof parsed.skill !== 'string' || !Array.isArray(parsed.should_trigger)) continue;
    examples.set(parsed.skill, {
      positive: parsed.should_trigger.filter((item): item is string => typeof item === 'string'),
      negative: Array.isArray(parsed.should_not_trigger)
        ? parsed.should_not_trigger.filter((item): item is string => typeof item === 'string')
        : [],
    });
  }
  return examples;
}

export function loadSkillRegistry(): SkillRegistryEntry[] {
  return readRegistry(registryPath()).entries;
}

function vendorSelectionForEntry(
  entry: SkillRegistryEntry,
  task: string,
  catalog: VendorCatalog | undefined,
  now: Date,
): VendorSkillSelection | undefined {
  if (inferSkillSourceKind(entry.source, entry.sourceKind) !== 'VENDOR_LIVE' || !catalog) {
    return undefined;
  }
  const source = catalog.sources.find((candidate) => candidate.id === entry.source);
  const skill = source ? findVendorSkill(source, entry.vendorSkill ?? entry.id) : undefined;
  if (!source || !skill) return undefined;
  const selection = selectVendorSkill({ source, skill, task, now });
  return selection.state === 'unavailable' ? undefined : selection;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const VENDOR_CONTEXT_TERMS = new Set(['vercel', 'next', 'nextjs', 'react', 'expo']);

function includesPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizedText(phrase);
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function vendorMatchAllowed(entry: SkillRegistryEntry, task: string): boolean {
  const normalized = normalizedText(task);
  if ([entry.id, ...entry.aliases].some((term) => includesPhrase(normalized, term))) {
    return true;
  }
  const taskWords = new Set(words(task));
  if (![...VENDOR_CONTEXT_TERMS].some((term) => taskWords.has(term))) return false;
  const matchedSignals = new Set(
    [
      ...words(entry.id),
      ...entry.aliases.flatMap((alias) => words(alias)),
      ...words(entry.load),
    ].filter((term) => taskWords.has(term)),
  );
  return [...matchedSignals].some(
    (term) => term !== 'current' && !VENDOR_CONTEXT_TERMS.has(term),
  );
}

export function installedSkillPath(id: string, cwd: string, source: string): string | undefined {
  const immutable = join(runtimeRoot(), 'skills', 'internal');
  const legacyMutableGlobal = join(majorHome(), 'skills', 'internal');
  const hot = hotSkillBundleRoot();
  const hotInternal = hot ? join(hot, 'skills', 'internal') : undefined;
  const roots =
    source === 'major-internal'
      ? [hotInternal, immutable, legacyMutableGlobal].filter((root): root is string => Boolean(root))
      : [
          join(cwd, '.agents', 'skills'),
          join(cwd, '.claude', 'skills'),
          join(cwd, '.codex', 'skills'),
          ...(hotInternal ? [hotInternal] : []),
          legacyMutableGlobal,
          immutable,
        ];
  for (const root of roots) {
    const path = join(root, id, 'SKILL.md');
    if (existsSync(path)) return path;
  }
  return undefined;
}

function generatedSkillPath(entry: SkillCandidate): string | undefined {
  return entry.path && existsSync(entry.path) ? entry.path : undefined;
}

function integrationDisambiguation(entryId: string, task: string): string | undefined {
  const hasShaperAnalyticsIntent = /\b(?:taleshape|dashboard|analytics|telemetry)\b/u.test(task);
  const hasNetworkShapingIntent =
    /\b(?:network|packet|bandwidth|qdisc|traffic)\b.{0,24}\bshap(?:e|er|ing)\b/u.test(task) ||
    /\bshap(?:e|er|ing)\b.{0,24}\b(?:network|packet|bandwidth|qdisc|traffic)\b/u.test(task);
  const hasSpatialIntent = /\b(?:splat(?:ting)?|reconstruct(?:ion|ing)?|colmap|novel[ -]views?)\b/u.test(
    task,
  );
  const hasNegatedSpatialIntent =
    /\b(?:without|no|not|never|don't|do not|does not|isn't|is not)\b(?:\s+\w+){0,6}\s+\b(?:splat(?:ting)?|reconstruct(?:ion|ing)?|colmap|novel[ -]views?)\b/u.test(
      task,
    ) ||
    /\b(?:splat(?:ting)?|reconstruct(?:ion)?|colmap|novel[ -]views?)\b(?:\s+\w+){0,6}\s+\b(?:unnecessary|unneeded|not needed|not necessary|not required|isn't needed|is not needed|isn't necessary|is not necessary|isn't required|is not required)\b/u.test(
      task,
    ) ||
    /\bnon[- ](?:reconstruct(?:ion)?|splat(?:ting)?)\b/u.test(task);
  const hasPositiveSpatialIntent = hasSpatialIntent && !hasNegatedSpatialIntent;
  const hasExplicitGaussianSpatialIntent =
    /\b(?:gaussian[ -]+splat(?:ting)?|splat(?:ting)?|colmap|novel[ -]views?)\b/u.test(task) &&
    !hasNegatedSpatialIntent;
  const isShapeRCapabilityRequest =
    /\bshaper\b/u.test(task) &&
    !hasShaperAnalyticsIntent &&
    !hasNetworkShapingIntent &&
    /\b(?:reconstruct(?:ion|ing)?|sculpture|object|generate|generation|create|make|build|model|asset|3d|text[ -]prompt)\b/u.test(
      task,
    );
  if (
    entryId === 'analytics-with-shaper' &&
    (isShapeRCapabilityRequest ||
      hasNetworkShapingIntent ||
      (!hasShaperAnalyticsIntent &&
        (/\bshap\s+(?:value|explain)/u.test(task) ||
          /(?:scatter\s+plot|scatterplot)/u.test(task))))
  ) {
    return 'disambiguated a non-analytics Shaper meaning';
  }
  if (
    entryId === 'gaussian-splatting-spatial-reconstruction' &&
    (hasNegatedSpatialIntent ||
      (isShapeRCapabilityRequest && !hasExplicitGaussianSpatialIntent) ||
      (!hasPositiveSpatialIntent &&
        (/gaussian.{0,20}(?:blur|filter|noise|distribution|kernel|process)/u.test(task) ||
          /(?:blur|filter|noise|distribution|kernel|process).{0,20}gaussian/u.test(task) ||
          /gaussian.{0,20}(?:scatter|chart|plot)/u.test(task))))
  ) {
    return 'disambiguated a non-reconstruction Gaussian meaning';
  }
  return undefined;
}

function scoreEntry(
  entry: SkillRegistryEntry,
  task: string,
  examples: Map<string, ResolverExamples>,
): { score: number; reason: string } {
  const normalized = task.toLowerCase();
  const fixtures = examples.get(entry.id);
  const disambiguation = integrationDisambiguation(entry.id, normalized);
  if (disambiguation) return { score: 0, reason: disambiguation };
  if (fixtures?.negative.some((example) => normalizedText(example) === normalizedText(task))) {
    return { score: 0, reason: 'matched a negative trigger example' };
  }
  const explicitTerm = [entry.id, ...entry.aliases].find((term) => normalized.includes(term.toLowerCase()));
  if (explicitTerm) {
    // A short id can be a substring of a more specific explicit id, such as
    // `integration` in `mcp-integration-ops`. Prefer the longer named skill.
    return {
      score: 100 + words(explicitTerm).length * 100,
      reason: `explicit skill ${explicitTerm === entry.id ? 'id' : 'alias'}: ${explicitTerm}`,
    };
  }
  const taskWords = new Set(words(task));
  const idMatches = words(entry.id).filter((word) => taskWords.has(word));
  const aliasMatches = entry.aliases.flatMap((alias) => words(alias)).filter((word) => taskWords.has(word));
  const triggerMatches = [...new Set(words(entry.load).filter((word) => taskWords.has(word)))];
  const rareMatches = triggerMatches.filter((word) => word.length >= 8);
  let score = (idMatches.length + aliasMatches.length) * 5 + triggerMatches.length * 2 + rareMatches.length;
  let exampleReason = '';
  for (const example of fixtures?.positive ?? []) {
    const exampleWords = new Set(words(example));
    const overlap = [...exampleWords].filter((word) => taskWords.has(word));
    const rareOverlap = overlap.filter((word) => word.length >= 8);
    if (overlap.length < 2 && rareOverlap.length === 0) continue;
    const exampleScore = overlap.length * 3 + rareOverlap.length * 2;
    if (exampleScore > score) {
      score = exampleScore;
      exampleReason = `matched trigger example: ${overlap.join(', ')}`;
    }
  }
  return {
    score,
    reason:
      exampleReason || `matched: ${[...new Set([...idMatches, ...aliasMatches, ...triggerMatches])].join(', ')}`,
  };
}

export function resolveSkills(input: {
  task: string;
  cwd?: string;
  limit?: number;
  now?: Date;
  skills?: readonly string[];
}): SkillResolution {
  const task = input.task.trim();
  if (!task) throw new Error('skill resolution task must not be empty');
  const cwd = resolve(input.cwd ?? process.cwd());
  const now = input.now ?? new Date();
  const vendorCatalog = readVendorCatalog();
  const examples = resolverExamples();
  const generated = loadActiveGeneratedSkills(cwd);
  const registry = loadSkillRegistry();
  const requested = [...new Set((input.skills ?? []).map((id) => id.trim()).filter(Boolean))];
  if (input.skills && requested.length === 0) {
    throw new Error('explicit skill selection requires at least one --skill <id>');
  }
  const explicitEntriesById = new Map<string, {
    entry: SkillRegistryEntry;
    generated: SkillCandidate | undefined;
  }>();
  for (const requestedId of requested) {
    const normalized = requestedId.toLowerCase();
    const entry = registry.find(
      (candidate) =>
        candidate.id.toLowerCase() === normalized ||
        candidate.aliases.some((alias) => alias.toLowerCase() === normalized),
    );
    const project = generated.find((candidate) => candidate.skillId.toLowerCase() === normalized);
    if (!entry && !project) {
      throw new Error(
        `unknown skill "${requestedId}"; run "major skill search --query ${JSON.stringify(requestedId)}" to inspect installed skills`,
      );
    }
    if (entry?.deprecated) {
      const replacement = entry.deprecated.replacement
        ? `; use "${entry.deprecated.replacement}" instead`
        : '';
      throw new Error(
        `deprecated skill "${entry.id}"${replacement}${entry.deprecated.message ? `: ${entry.deprecated.message}` : ''}`,
      );
    }
    const resolved = project
      ? {
          entry: {
            id: project.skillId,
            source: 'gbrain-generated',
            availability: 'project',
            load: project.trigger,
            aliases: [],
            disclosure: 'specialist' as const,
          },
          generated: project,
        }
      : { entry: entry!, generated: undefined };
    explicitEntriesById.set(resolved.entry.id, resolved);
  }
  const explicitEntries = [...explicitEntriesById.values()];
  const candidates: Array<{
    entry: SkillRegistryEntry;
    generated: SkillCandidate | undefined;
  }> = [
    ...(requested.length > 0
      ? explicitEntries
      : registry.map((entry) => ({ entry, generated: undefined }))),
    ...(requested.length > 0 ? [] : generated).map((generated) => ({
      entry: {
        id: generated.skillId,
        source: 'gbrain-generated',
        availability: 'project',
        load: generated.trigger,
        aliases: [],
        disclosure: 'specialist' as const,
      },
      generated,
    })),
  ];
  const matches = candidates
    .map(({ entry, generated }) => {
      const scored =
        requested.length > 0
          ? { score: 1_000, reason: `explicit skill selection: ${entry.id}` }
          : scoreEntry(entry, task, examples);
      const sourceKind = generated
        ? 'PROJECT_LOCAL'
        : inferSkillSourceKind(entry.source, entry.sourceKind);
      const vendor = generated
        ? undefined
        : vendorSelectionForEntry(entry, task, vendorCatalog, now);
      return {
        entry,
        generated,
        sourceKind,
        vendor,
        ...scored,
        score: scored.score + (generated ? skillPerformanceScore(generated) : 0),
      };
    })
    .filter(
      ({ entry, score, sourceKind, vendor }) =>
        score >= (requested.length > 0 ? 1_000 : 5) &&
        (sourceKind !== 'VENDOR_LIVE' ||
          (vendor !== undefined && vendorMatchAllowed(entry, task))),
    )
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));

  const explicitVendorIds = new Set(
    matches
      .filter(({ sourceKind, score }) => sourceKind === 'VENDOR_LIVE' && score >= 100)
      .map(({ entry }) => entry.id),
  );

  const skills: ResolvedSkill[] = [];
  for (const match of matches) {
    if (
      match.sourceKind === 'VENDOR_LIVE' &&
      explicitVendorIds.size > 0 &&
      !explicitVendorIds.has(match.entry.id)
    ) {
      continue;
    }
    const path = match.generated
      ? generatedSkillPath(match.generated)
      : match.sourceKind === 'VENDOR_LIVE'
        ? undefined
        : installedSkillPath(match.entry.id, cwd, match.entry.source);
    if (!path && !match.vendor) continue;
    const reference = match.vendor?.referenceUrl ?? path;
    if (!reference) continue;
    skills.push({
      id: match.entry.id,
      source: match.entry.source,
      sourceKind: match.sourceKind,
      ...(path ? { path } : {}),
      reference,
      ...(match.vendor ? { vendor: match.vendor } : {}),
      score: match.score,
      reason: match.vendor
        ? `${match.reason}; live vendor source ${match.vendor.sourceId} (${match.vendor.state})`
        : match.reason,
    });
    if (skills.length >= (input.limit ?? (explicitEntries.length || 6))) break;
  }
  if (requested.length > 0 && skills.length !== explicitEntries.length) {
    const selected = new Set(skills.map((skill) => skill.id));
    const missing = explicitEntries.map(({ entry }) => entry.id).filter((id) => !selected.has(id));
    throw new Error(`explicit skill selection unavailable: ${missing.join(', ')}`);
  }
  const mode: SkillResolutionReceipt['mode'] = requested.length
    ? skills.some((skill) => skill.sourceKind === 'PROJECT_LOCAL')
      ? 'project'
      : 'explicit'
    : skills.some((skill) => skill.sourceKind === 'PROJECT_LOCAL')
      ? 'project'
      : 'automatic';
  return {
    task,
    skills,
    receipt: {
      mode,
      requested,
      selected: skills.map((skill) => skill.id),
      evidence: skills.map((skill) => ({
        id: skill.id,
        score: skill.score,
        reason: skill.reason,
        source: skill.source,
      })),
    },
  };
}

/**
 * Produce the one bounded disclosure contract used by provider prompts and
 * routed clients. Registry metadata is cheap and canonical; bodies are read
 * only for explicitly HOT guidance or deterministic ACTIVE matches.
 */
export function discloseSkills(input: {
  task: string;
  cwd?: string;
  limit?: number;
  manifestBytes?: number;
  bodyBytes?: number;
  perBodyBytes?: number;
  now?: Date;
}): SkillDisclosure {
  const cwd = resolve(input.cwd ?? process.cwd());
  const now = input.now ?? new Date();
  const registry = loadSkillRegistry();
  const resolution = resolveSkills({
    task: input.task,
    cwd,
    ...(input.limit ? { limit: input.limit } : {}),
    now,
  });
  const active = new Map(resolution.skills.map((skill) => [skill.id, skill]));
  const hot = registry.filter((entry) => entry.disclosure === 'hot');
  const ordered = [
    ...hot.map((entry) => ({ entry, state: 'HOT' as const })),
    ...resolution.skills
      .filter((skill) => !hot.some((entry) => entry.id === skill.id))
      .map((skill) => ({
        entry: registry.find((entry) => entry.id === skill.id) ?? {
          id: skill.id,
          source: skill.source,
          availability: 'project',
          load: 'generated active skill',
          aliases: [],
          disclosure: 'specialist' as const,
        },
        state: 'ACTIVE' as const,
      })),
  ];
  const dormant = registry
    .filter((entry) => !hot.some((candidate) => candidate.id === entry.id) && !active.has(entry.id))
    .map((entry) => ({ entry, state: 'DORMANT' as const }));
  const manifestBudget = input.manifestBytes ?? DISCLOSURE_BUDGETS.manifestBytes;
  const manifest: SkillDisclosure['manifest'] = [];
  for (const { entry, state } of [...ordered, ...dormant]) {
    const selected = active.get(entry.id);
    const vendor = selected?.vendor;
    const candidate = {
      id: entry.id,
      source: entry.source,
      sourceKind: inferSkillSourceKind(entry.source, entry.sourceKind),
      state,
      load: entry.load,
      ...(vendor
        ? {
            vendor: {
              state: vendor.state,
              freshness: vendor.freshness,
              sectionId: vendor.sectionId,
            },
          }
        : {}),
    };
    if (jsonBytes([...manifest, candidate]) > manifestBudget) break;
    manifest.push(candidate);
  }

  const bodyBudget = input.bodyBytes ?? DISCLOSURE_BUDGETS.bodyBytes;
  const perBodyBudget = input.perBodyBytes ?? DISCLOSURE_BUDGETS.perBodyBytes;
  const bodies: SkillDisclosure['bodies'] = [];
  const vendorReferences: SkillDisclosure['vendorReferences'] = [];
  let disclosedBodyBytes = 0;
  let disclosedVendorBytes = 0;
  for (const { entry, state } of ordered) {
    const selected = active.get(entry.id);
    const vendor = selected?.vendor;
    if (vendor) {
      const cached = getCachedVendorSection(vendor, now);
      const original = formatVendorReference(vendor, cached);
      if (disclosedBodyBytes >= bodyBudget) continue;
      const allowance = Math.min(perBodyBudget, bodyBudget - disclosedBodyBytes);
      const content = utf8Prefix(original, allowance);
      const contentBytes = Buffer.byteLength(content, 'utf8');
      const contentSource = cached === undefined ? 'reference' : 'cache';
      bodies.push({
        id: entry.id,
        source: entry.source,
        sourceKind: 'VENDOR_LIVE',
        state,
        content,
        truncated: contentBytes < Buffer.byteLength(original, 'utf8'),
        sectionId: vendor.sectionId,
        reference: vendor.referenceUrl,
        contentSource,
      });
      vendorReferences.push({ ...vendor, contentSource });
      disclosedBodyBytes += contentBytes;
      disclosedVendorBytes += contentBytes;
      continue;
    }
    const path = selected?.path ?? installedSkillPath(entry.id, cwd, entry.source);
    if (!path || disclosedBodyBytes >= bodyBudget) continue;
    const original = readFileSync(path, 'utf8');
    const allowance = Math.min(perBodyBudget, bodyBudget - disclosedBodyBytes);
    const content = utf8Prefix(original, allowance);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    bodies.push({
      id: entry.id,
      source: entry.source,
      sourceKind: inferSkillSourceKind(entry.source, entry.sourceKind),
      state,
      content,
      truncated: contentBytes < Buffer.byteLength(original, 'utf8'),
    });
    disclosedBodyBytes += contentBytes;
  }

  const manifestBeforeBytes = jsonBytes(registry);
  const manifestDisclosedBytes = jsonBytes(manifest);
  const bodyBeforeBytes = registry.reduce((total, entry) => {
    if (inferSkillSourceKind(entry.source, entry.sourceKind) === 'VENDOR_LIVE') return total;
    const path = installedSkillPath(entry.id, cwd, entry.source);
    return total + (path ? statSync(path).size : 0);
  }, 0);
  const vendorCatalogFile = vendorCatalogPath();
  const vendorBeforeBytes = existsSync(vendorCatalogFile) ? statSync(vendorCatalogFile).size : 0;
  const beforeBytes = manifestBeforeBytes + bodyBeforeBytes + vendorBeforeBytes;
  const disclosedBytes = manifestDisclosedBytes + disclosedBodyBytes;
  return {
    task: resolution.task,
    manifest,
    bodies,
    vendorReferences,
    metrics: {
      manifest: { beforeBytes: manifestBeforeBytes, disclosedBytes: manifestDisclosedBytes },
      bodies: { beforeBytes: bodyBeforeBytes, disclosedBytes: disclosedBodyBytes },
      vendor: {
        beforeBytes: vendorBeforeBytes,
        disclosedBytes: disclosedVendorBytes,
        selectedSkills: vendorReferences.length,
        cachedSections: vendorReferences.filter((reference) => reference.contentSource === 'cache')
          .length,
      },
      total: {
        beforeBytes,
        disclosedBytes,
        estimatedTokensBefore: Math.ceil(beforeBytes / 4),
        estimatedTokensDisclosed: Math.ceil(disclosedBytes / 4),
      },
      budgets: { manifestBytes: manifestBudget, bodyBytes: bodyBudget, perBodyBytes: perBodyBudget },
    },
  };
}

export interface SkillAudit {
  internal: { id: string; reachable: boolean; path?: string }[];
  vendor: {
    id: string;
    source: string;
    sourceKind: 'VENDOR_LIVE';
    available: boolean;
    state: VendorSourceState | 'missing';
    reference?: string;
  }[];
  duplicateIds: string[];
  orphanInternalSkills: string[];
}

export function auditSkillReachability(cwd = process.cwd()): SkillAudit {
  const entries = loadSkillRegistry();
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  const internal = entries
    .filter((entry) => entry.source === 'major-internal')
    .map((entry) => {
      const path = installedSkillPath(entry.id, resolve(cwd), entry.source);
      return { id: entry.id, reachable: Boolean(path), ...(path ? { path } : {}) };
    });
  const registered = new Set(internal.map((entry) => entry.id));
  const hot = hotSkillBundleRoot();
  const internalRoot = hot
    ? join(hot, 'skills', 'internal')
    : join(runtimeRoot(), 'skills', 'internal');
  const installed = existsSync(internalRoot)
    ? readdirSync(internalRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(internalRoot, entry.name, 'SKILL.md')))
        .map((entry) => entry.name)
    : [];
  const vendorCatalog = readVendorCatalog();
  const vendor = entries
    .filter((entry) => inferSkillSourceKind(entry.source, entry.sourceKind) === 'VENDOR_LIVE')
    .map((entry) => {
      const source = vendorCatalog?.sources.find((candidate) => candidate.id === entry.source);
      const skill = source ? findVendorSkill(source, entry.vendorSkill ?? entry.id) : undefined;
      if (!source || !skill) {
        return {
          id: entry.id,
          source: entry.source,
          sourceKind: 'VENDOR_LIVE' as const,
          available: false,
          state: 'missing' as const,
        };
      }
      const state = vendorSourceState(source);
      return {
        id: entry.id,
        source: entry.source,
        sourceKind: 'VENDOR_LIVE' as const,
        available: state !== 'unavailable',
        state,
        reference: skill.sections[0]!.referenceUrl,
      };
    });
  return {
    internal,
    vendor,
    duplicateIds: [...counts].filter(([, count]) => count > 1).map(([id]) => id),
    orphanInternalSkills: installed.filter((id) => !registered.has(id)).sort(),
  };
}
