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

const registryEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  availability: z.string(),
  load: z.string(),
  aliases: z.array(z.string().min(1)).default([]),
  disclosure: z.enum(['hot', 'specialist']).default('specialist'),
  exclusiveGroup: z.string().min(1).optional(),
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
  path: string;
  score: number;
  reason: string;
}

export interface SkillResolution {
  task: string;
  skills: ResolvedSkill[];
}

export type SkillDisclosureState = 'HOT' | 'ACTIVE' | 'DORMANT';

export interface SkillDisclosure {
  task: string;
  manifest: Array<{
    id: string;
    source: string;
    state: SkillDisclosureState;
    load: string;
  }>;
  bodies: Array<{
    id: string;
    source: string;
    state: Exclude<SkillDisclosureState, 'DORMANT'>;
    content: string;
    truncated: boolean;
  }>;
  metrics: {
    manifest: { beforeBytes: number; disclosedBytes: number };
    bodies: { beforeBytes: number; disclosedBytes: number };
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
  'brand',
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

function includesNormalizedPhrase(value: string, phrase: string): boolean {
  return ` ${normalizedText(value)} `.includes(` ${normalizedText(phrase)} `);
}

function skillPath(id: string, cwd: string, source: string): string | undefined {
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

function scoreEntry(
  entry: SkillRegistryEntry,
  task: string,
  examples: Map<string, ResolverExamples>,
): { score: number; reason: string } {
  const normalized = task.toLowerCase();
  const fixtures = examples.get(entry.id);
  if (fixtures?.negative.some((example) => normalizedText(example) === normalizedText(task))) {
    return { score: 0, reason: 'matched a negative trigger example' };
  }
  const explicitTerm = [entry.id, ...entry.aliases].find((term, index) =>
    index === 0 ? normalized.includes(term.toLowerCase()) : includesNormalizedPhrase(task, term),
  );
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
  const triggerMatches = [...new Set(words(entry.load).filter((word) => taskWords.has(word)))];
  const rareMatches = triggerMatches.filter((word) => word.length >= 8);
  let score = idMatches.length * 5 + triggerMatches.length * 2 + rareMatches.length;
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
      exampleReason || `matched: ${[...new Set([...idMatches, ...triggerMatches])].join(', ')}`,
  };
}

export function resolveSkills(input: {
  task: string;
  cwd?: string;
  limit?: number;
}): SkillResolution {
  const task = input.task.trim();
  if (!task) throw new Error('skill resolution task must not be empty');
  const cwd = resolve(input.cwd ?? process.cwd());
  const examples = resolverExamples();
  const generated = loadActiveGeneratedSkills(cwd);
  const matches = [
    ...loadSkillRegistry().map((entry) => ({ entry, generated: undefined })),
    ...generated.map((generated) => ({
      entry: {
        id: generated.skillId,
        source: 'gbrain-generated',
        availability: 'project',
        load: generated.trigger,
        aliases: [],
        disclosure: 'specialist' as const,
        exclusiveGroup: undefined,
      },
      generated,
    })),
  ]
    .map(({ entry, generated }) => {
      const scored = scoreEntry(entry, task, examples);
      return {
        entry,
        generated,
        ...scored,
        score: scored.score + (generated ? skillPerformanceScore(generated) : 0),
      };
    })
    .filter(({ score }) => score >= 5)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));

  const skills: ResolvedSkill[] = [];
  const selectedExclusiveGroups = new Set<string>();
  for (const match of matches) {
    if (
      match.entry.exclusiveGroup &&
      selectedExclusiveGroups.has(match.entry.exclusiveGroup)
    ) {
      continue;
    }
    const path = match.generated
      ? generatedSkillPath(match.generated)
      : skillPath(match.entry.id, cwd, match.entry.source);
    if (!path) continue;
    skills.push({
      id: match.entry.id,
      source: match.entry.source,
      path,
      score: match.score,
      reason: match.reason,
    });
    if (match.entry.exclusiveGroup) selectedExclusiveGroups.add(match.entry.exclusiveGroup);
    if (skills.length >= (input.limit ?? 6)) break;
  }
  return { task, skills };
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
}): SkillDisclosure {
  const cwd = resolve(input.cwd ?? process.cwd());
  const registry = loadSkillRegistry();
  const resolution = resolveSkills({ task: input.task, cwd, ...(input.limit ? { limit: input.limit } : {}) });
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
    const candidate = { id: entry.id, source: entry.source, state, load: entry.load };
    if (jsonBytes([...manifest, candidate]) > manifestBudget) break;
    manifest.push(candidate);
  }

  const bodyBudget = input.bodyBytes ?? DISCLOSURE_BUDGETS.bodyBytes;
  const perBodyBudget = input.perBodyBytes ?? DISCLOSURE_BUDGETS.perBodyBytes;
  const bodies: SkillDisclosure['bodies'] = [];
  let disclosedBodyBytes = 0;
  for (const { entry, state } of ordered) {
    const selected = active.get(entry.id);
    const path = selected?.path ?? skillPath(entry.id, cwd, entry.source);
    if (!path || disclosedBodyBytes >= bodyBudget) continue;
    const original = readFileSync(path, 'utf8');
    const allowance = Math.min(perBodyBudget, bodyBudget - disclosedBodyBytes);
    const content = utf8Prefix(original, allowance);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    bodies.push({
      id: entry.id,
      source: entry.source,
      state,
      content,
      truncated: contentBytes < Buffer.byteLength(original, 'utf8'),
    });
    disclosedBodyBytes += contentBytes;
  }

  const manifestBeforeBytes = jsonBytes(registry);
  const manifestDisclosedBytes = jsonBytes(manifest);
  const bodyBeforeBytes = registry.reduce((total, entry) => {
    const path = skillPath(entry.id, cwd, entry.source);
    return total + (path ? statSync(path).size : 0);
  }, 0);
  const beforeBytes = manifestBeforeBytes + bodyBeforeBytes;
  const disclosedBytes = manifestDisclosedBytes + disclosedBodyBytes;
  return {
    task: resolution.task,
    manifest,
    bodies,
    metrics: {
      manifest: { beforeBytes: manifestBeforeBytes, disclosedBytes: manifestDisclosedBytes },
      bodies: { beforeBytes: bodyBeforeBytes, disclosedBytes: disclosedBodyBytes },
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
      const path = skillPath(entry.id, resolve(cwd), entry.source);
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
  return {
    internal,
    duplicateIds: [...counts].filter(([, count]) => count > 1).map(([id]) => id),
    orphanInternalSkills: installed.filter((id) => !registered.has(id)).sort(),
  };
}
