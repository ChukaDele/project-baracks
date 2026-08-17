import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
});

const registrySchema = z.object({
  version: z.number().int().positive(),
  entries: z.array(registryEntrySchema),
});

const bundleSchema = z.object({
  version: z.literal(1),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
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
 * registry/skill tree) and its registry is at least as new as the immutable
 * release registry. An older or partial bundle is ignored fail-closed.
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
    const immutable = readRegistry(join(runtimeRoot(), 'guidance', 'skills.registry.json'));
    return hot.version >= immutable.version ? root : undefined;
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
  if (normalized.includes(entry.id.toLowerCase())) {
    return { score: 100, reason: `explicit skill id: ${entry.id}` };
  }
  const taskWords = new Set(words(task));
  const idMatches = words(entry.id).filter((word) => taskWords.has(word));
  const triggerMatches = [...new Set(words(entry.load).filter((word) => taskWords.has(word)))];
  const rareMatches = triggerMatches.filter((word) => word.length >= 8);
  let score = idMatches.length * 5 + triggerMatches.length * 2 + rareMatches.length;
  let exampleReason = '';
  const fixtures = examples.get(entry.id);
  if (fixtures?.negative.some((example) => normalizedText(example) === normalizedText(task))) {
    return { score: 0, reason: 'matched a negative trigger example' };
  }
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
  for (const match of matches) {
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
    if (skills.length >= (input.limit ?? 6)) break;
  }
  return { task, skills };
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
