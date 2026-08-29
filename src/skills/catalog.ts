import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { SkillRegistryEntry } from './resolver.js';

export interface SkillCatalogEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  shortDescription: string;
  aliases: string[];
  triggerConditions: string[];
  category: string;
  version: string;
  lifecycle: 'active' | 'deprecated' | 'experimental';
  availability: string;
  applicableProjects: string[];
  source: string;
  provenance: Record<string, unknown>;
  dependencies: string[];
  sourceKind: string;
  registryVersion: number;
  contentSha256?: string;
  triggers: string[];
  deprecated?: { replacement?: string | undefined; message?: string | undefined };
}

function frontmatterDescription(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const skillFile = lstatSync(path).isDirectory() ? join(path, 'SKILL.md') : path;
  const match = readFileSync(skillFile, 'utf8').match(/^---\n[\s\S]*?^description:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

/** Stable identity for every regular file shipped by a skill, not just its entrypoint. */
export function skillContentSha256(path: string): string {
  const root = lstatSync(path).isDirectory() ? path : dirname(path);
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`unsupported skill content entry: ${relative(root, child)}`);
    }
  };
  walk(root);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  if (!files.some((file) => basename(file) === 'SKILL.md'))
    throw new Error(`skill directory missing SKILL.md: ${root}`);
  return hash.digest('hex');
}

export function buildSkillCatalog(
  entries: readonly SkillRegistryEntry[],
  locate: (entry: SkillRegistryEntry) => string | undefined,
  registryVersion = 1,
): SkillCatalogEntry[] {
  const knownIds = new Set(entries.map((entry) => entry.id));
  return entries
    .map((entry) => {
      const path = locate(entry);
      const description = frontmatterDescription(path) ?? entry.load.replaceAll('-', ' ');
      const sourceText = path ? readFileSync(lstatSync(path).isDirectory() ? join(path, 'SKILL.md') : path, 'utf8') : '';
      const lifecycle: SkillCatalogEntry['lifecycle'] = entry.deprecated
        ? 'deprecated'
        : entry.experimental
          ? 'experimental'
          : 'active';
      const dependencies = [
        ...(entry.dependencies ?? []),
        ...[...knownIds].filter(
          (id) => id !== entry.id && sourceText.includes(id),
        ),
      ].filter((id, index, all) => all.indexOf(id) === index);
      return {
      id: entry.id,
      name: entry.id,
      title: entry.id
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      description,
      shortDescription: description,
      aliases: entry.aliases,
      triggerConditions: [entry.load],
      category: entry.category ?? 'uncategorized',
      version: String(entry.version ?? registryVersion),
      lifecycle,
      availability: entry.availability,
      applicableProjects: [entry.availability],
      source: entry.source,
      provenance: entry.provenance ?? { kind: 'canonical-registry', registryVersion },
      dependencies,
      sourceKind:
        entry.sourceKind ??
        (entry.source === 'major-internal'
          ? 'INTERNAL_DURABLE'
          : entry.source === 'gbrain-generated'
            ? 'PROJECT_LOCAL'
            : 'DORMANT_REFERENCE'),
      registryVersion,
      ...(path
        ? { contentSha256: skillContentSha256(path) }
        : {}),
      triggers: entry.load.split('-').filter(Boolean),
      ...(entry.deprecated ? { deprecated: entry.deprecated } : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadGeneratedSkillCatalog(path: string): {
  version: 1;
  registryVersion: number;
  entries: SkillCatalogEntry[];
} {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (value.version !== 1 || !Number.isInteger(value.registryVersion) || !Array.isArray(value.entries))
    throw new Error('invalid generated skill catalogue');
  return value as { version: 1; registryVersion: number; entries: SkillCatalogEntry[] };
}

export function searchSkillCatalog(
  entries: readonly SkillCatalogEntry[],
  query: string,
): SkillCatalogEntry[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (terms.length === 0) return [...entries];
  return entries
    .map((entry) => {
      const text = [entry.id, entry.title, entry.description, ...entry.aliases, ...entry.triggers]
        .join(' ')
        .toLowerCase();
      return { entry, score: terms.filter((term) => text.includes(term)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .map(({ entry }) => entry);
}
