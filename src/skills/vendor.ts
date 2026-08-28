import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

export const SKILL_SOURCE_KINDS = [
  'INTERNAL_DURABLE',
  'VENDOR_LIVE',
  'PROJECT_LOCAL',
  'DORMANT_REFERENCE',
] as const;

export type SkillSourceKind = (typeof SKILL_SOURCE_KINDS)[number];

export function inferSkillSourceKind(
  source: string,
  explicit?: SkillSourceKind,
): SkillSourceKind {
  if (explicit) return explicit;
  if (source === 'major-internal') return 'INTERNAL_DURABLE';
  if (source === 'gbrain-generated') return 'PROJECT_LOCAL';
  return 'DORMANT_REFERENCE';
}

const vendorSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  referenceUrl: z.string().url(),
  retrievalUrl: z.string().url().optional(),
});

const vendorSkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().min(1).optional(),
  harvestDecision: z.enum([
    'USE_LIVE',
    'CONFIGURE',
    'MERGE_DURABLE_PATTERN',
    'INTERNALIZE',
    'REJECT',
  ]),
  classification: z.enum(['knowledge-index', 'actionable-skill']),
  title: z.string().min(1),
  skillUrl: z.string().url(),
  retrievalUrl: z.string().url(),
  keywords: z.array(z.string().min(1)).min(1),
  sections: z.array(vendorSectionSchema).min(1),
});

const vendorSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.literal('VENDOR_LIVE'),
  vendor: z.string().min(1),
  sourceUrl: z.string().url(),
  repositoryUrl: z.string().url(),
  revision: z.string().min(1),
  version: z.string().nullable(),
  lastChecked: z.string().min(1),
  freshnessTtlMs: z.number().int().positive().max(31_536_000_000),
  license: z.string().min(1),
  licenseStatus: z.string().min(1),
  provenance: z.string().min(1),
  supportedClients: z.array(z.string().min(1)).min(1),
  resolverDomains: z.array(z.string().min(1)).min(1),
  availability: z.enum(['available', 'degraded', 'unavailable']),
  degradedReason: z.string().nullable(),
  skills: z.array(vendorSkillSchema).min(1),
});

export const vendorCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('major.vendor-skill-sources'),
  sources: z.array(vendorSourceSchema).min(1),
});

export type VendorCatalog = z.infer<typeof vendorCatalogSchema>;
export type VendorSource = VendorCatalog['sources'][number];
export type VendorSkill = VendorSource['skills'][number];
export type VendorSection = VendorSkill['sections'][number];
export type VendorAvailability = VendorSource['availability'];
export type VendorFreshness = 'fresh' | 'stale' | 'unknown';
export type VendorSourceState = VendorFreshness | 'degraded' | 'unavailable';

export interface VendorSkillSelection {
  sourceId: string;
  sourceKind: 'VENDOR_LIVE';
  vendor: string;
  skillId: string;
  classification: VendorSkill['classification'];
  harvestDecision: VendorSkill['harvestDecision'];
  title: string;
  sectionId: string;
  sectionTitle: string;
  referenceUrl: string;
  retrievalUrl: string;
  sourceUrl: string;
  repositoryUrl: string;
  revision: string;
  sourceVersion: string | null;
  skillVersion?: string;
  lastChecked: string;
  freshnessTtlMs: number;
  freshness: VendorFreshness;
  availability: VendorAvailability;
  state: VendorSourceState;
  license: string;
  licenseStatus: string;
  supportedClients: string[];
}

export interface VendorSectionFetchResult {
  selection: VendorSkillSelection;
  content: string;
  fetchedAt: string;
  fromCache: boolean;
}

interface CachedSection {
  fetchedAtMs: number;
  content: string;
}

const MAX_CACHED_SECTIONS = 32;
const MAX_VENDOR_DOCUMENT_BYTES = 512_000;
const vendorSectionCache = new Map<string, CachedSection>();

export function loadVendorCatalog(path: string): VendorCatalog {
  if (!existsSync(path)) throw new Error(`vendor source catalog is unavailable: ${path}`);
  return vendorCatalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function vendorFreshnessState(
  source: Pick<VendorSource, 'lastChecked' | 'freshnessTtlMs' | 'availability'>,
  now = new Date(),
): VendorFreshness {
  if (source.availability !== 'available') return 'unknown';
  const checkedAtMs = Date.parse(source.lastChecked);
  const nowMs = now.getTime();
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(nowMs) || checkedAtMs > nowMs) {
    return 'unknown';
  }
  return nowMs - checkedAtMs <= source.freshnessTtlMs ? 'fresh' : 'stale';
}

export function vendorSourceState(source: VendorSource, now = new Date()): VendorSourceState {
  if (source.availability === 'unavailable') return 'unavailable';
  if (source.availability === 'degraded') return 'degraded';
  return vendorFreshnessState(source, now);
}

function sourceStateFreshness(state: VendorSourceState): VendorFreshness {
  return state === 'fresh' || state === 'stale' || state === 'unknown' ? state : 'unknown';
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

function sectionScore(section: VendorSection, task: string): number {
  const taskWords = words(task);
  return section.keywords.reduce((score, keyword) => {
    const keywordWords = words(keyword);
    const overlap = [...keywordWords].filter((word) => taskWords.has(word));
    return score + overlap.length * 2 + (overlap.some((word) => word.length >= 8) ? 1 : 0);
  }, 0);
}

export function findVendorSkill(source: VendorSource, skillId: string): VendorSkill | undefined {
  return source.skills.find((skill) => skill.id === skillId);
}

export function selectVendorSkill(input: {
  source: VendorSource;
  skill: VendorSkill;
  task: string;
  now?: Date;
}): VendorSkillSelection {
  const task = input.task.trim();
  if (!task) throw new Error('vendor skill selection task must not be empty');
  const section = input.skill.sections
    .map((candidate, index) => ({ candidate, index, score: sectionScore(candidate, task) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.index - right.index ||
        left.candidate.id.localeCompare(right.candidate.id),
    )[0]!.candidate;
  const state = vendorSourceState(input.source, input.now);
  return {
    sourceId: input.source.id,
    sourceKind: 'VENDOR_LIVE',
    vendor: input.source.vendor,
    skillId: input.skill.id,
    classification: input.skill.classification,
    harvestDecision: input.skill.harvestDecision,
    title: input.skill.title,
    sectionId: section.id,
    sectionTitle: section.title,
    referenceUrl: section.referenceUrl,
    retrievalUrl: section.retrievalUrl ?? input.skill.retrievalUrl,
    sourceUrl: input.source.sourceUrl,
    repositoryUrl: input.source.repositoryUrl,
    revision: input.source.revision,
    sourceVersion: input.source.version,
    ...(input.skill.version ? { skillVersion: input.skill.version } : {}),
    lastChecked: input.source.lastChecked,
    freshnessTtlMs: input.source.freshnessTtlMs,
    freshness: sourceStateFreshness(state),
    availability: input.source.availability,
    state,
    license: input.source.license,
    licenseStatus: input.source.licenseStatus,
    supportedClients: [...input.source.supportedClients],
  };
}

export function discoverVendorSkills(input: {
  catalog: VendorCatalog;
  task: string;
  now?: Date;
}): VendorSkillSelection[] {
  return input.catalog.sources.flatMap((source) =>
    source.skills
      .map((skill) =>
        selectVendorSkill({
          source,
          skill,
          task: input.task,
          ...(input.now ? { now: input.now } : {}),
        }),
      )
      .filter((selection) => selection.state !== 'unavailable'),
  );
}

function cacheKey(selection: VendorSkillSelection): string {
  return `${selection.sourceId}:${selection.skillId}:${selection.sectionId}`;
}

function cacheSection(selection: VendorSkillSelection, content: string, fetchedAtMs: number): void {
  vendorSectionCache.delete(cacheKey(selection));
  vendorSectionCache.set(cacheKey(selection), { fetchedAtMs, content });
  while (vendorSectionCache.size > MAX_CACHED_SECTIONS) {
    const oldest = vendorSectionCache.keys().next().value;
    if (oldest === undefined) break;
    vendorSectionCache.delete(oldest);
  }
}

export function clearVendorSectionCache(): void {
  vendorSectionCache.clear();
}

export function getCachedVendorSection(
  selection: VendorSkillSelection,
  now = new Date(),
): string | undefined {
  if (selection.availability !== 'available' || selection.freshness !== 'fresh') return undefined;
  const cached = vendorSectionCache.get(cacheKey(selection));
  if (!cached) return undefined;
  const ageMs = now.getTime() - cached.fetchedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > selection.freshnessTtlMs) {
    vendorSectionCache.delete(cacheKey(selection));
    return undefined;
  }
  return cached.content;
}

export function formatVendorReference(
  selection: VendorSkillSelection,
  sectionContent?: string,
): string {
  const lines = [
    `Vendor: ${selection.vendor}`,
    `Capability: ${selection.title} (${selection.classification})`,
    `Harvest disposition: ${selection.harvestDecision}`,
    `Selected section: ${selection.sectionTitle}`,
    `Source state: ${selection.state} (availability=${selection.availability}, freshness=${selection.freshness})`,
    `Source revision: ${selection.revision}; source version: ${selection.sourceVersion ?? 'not declared'}; skill version: ${selection.skillVersion ?? 'not declared'}; last checked: ${selection.lastChecked}; TTL: ${selection.freshnessTtlMs}ms`,
    `Official section reference: ${selection.referenceUrl}`,
    `Section retrieval URL: ${selection.retrievalUrl}`,
    `Source license/provenance: ${selection.licenseStatus}; ${selection.license}`,
    'Only this selected section is disclosed. The live vendor source does not grant deployment, claim, merge, or production authority.',
  ];
  if (sectionContent) {
    lines.push('', `CURRENT ${selection.vendor} SECTION (${selection.sectionTitle}):`, sectionContent);
  }
  return lines.join('\n');
}

function normalizedHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extractMarkdownSection(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const expected = normalizedHeading(title);
  let start = -1;
  let level = 0;
  for (const [index, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match && normalizedHeading(match[2]!) === expected) {
      start = index + 1;
      level = match[1]!.length;
      break;
    }
  }
  if (start < 0) throw new Error(`vendor section not found: ${title}`);
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[index]!);
    if (match && match[1]!.length <= level) {
      end = index;
      break;
    }
  }
  const content = lines.slice(start, end).join('\n').trim();
  if (!content) throw new Error(`vendor section is empty: ${title}`);
  return content;
}

export async function fetchVendorSection(input: {
  selection: VendorSkillSelection;
  fetchImpl?: typeof fetch;
  now?: Date;
  signal?: AbortSignal;
}): Promise<VendorSectionFetchResult> {
  const now = input.now ?? new Date();
  const cached = getCachedVendorSection(input.selection, now);
  if (cached !== undefined) {
    return {
      selection: input.selection,
      content: cached,
      fetchedAt: new Date(now.getTime()).toISOString(),
      fromCache: true,
    };
  }
  if (input.selection.availability !== 'available') {
    throw new Error(`vendor source is ${input.selection.availability}: ${input.selection.vendor}`);
  }
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(input.selection.retrievalUrl, {
    headers: { accept: 'text/markdown, text/plain;q=0.9' },
    signal: input.signal ?? AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`vendor source returned HTTP ${response.status}: ${input.selection.retrievalUrl}`);
  }
  const document = await response.text();
  if (Buffer.byteLength(document, 'utf8') > MAX_VENDOR_DOCUMENT_BYTES) {
    throw new Error('vendor source document exceeds the bounded retrieval limit');
  }
  const content = extractMarkdownSection(document, input.selection.sectionTitle);
  const fetchedAtMs = now.getTime();
  if (!Number.isFinite(fetchedAtMs)) throw new Error('vendor fetch time is invalid');
  cacheSection(input.selection, content, fetchedAtMs);
  return {
    selection: input.selection,
    content,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    fromCache: false,
  };
}
