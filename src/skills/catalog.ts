import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SkillRegistryEntry } from './resolver.js';

export interface SkillCatalogEntry {
  id: string;
  title: string;
  description: string;
  aliases: string[];
  availability: string;
  source: string;
  sourceKind: string;
  registryVersion: number;
  contentSha256?: string;
  triggers: string[];
  deprecated?: { replacement?: string | undefined; message?: string | undefined };
}

function frontmatterDescription(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const match = readFileSync(path, 'utf8').match(/^---\n[\s\S]*?^description:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

export function buildSkillCatalog(
  entries: readonly SkillRegistryEntry[],
  locate: (entry: SkillRegistryEntry) => string | undefined,
  registryVersion = 1,
): SkillCatalogEntry[] {
  return entries
    .map((entry) => {
      const path = locate(entry);
      return {
      id: entry.id,
      title: entry.id
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      description: frontmatterDescription(path) ?? entry.load.replaceAll('-', ' '),
      aliases: entry.aliases,
      availability: entry.availability,
      source: entry.source,
      sourceKind:
        entry.sourceKind ??
        (entry.source === 'major-internal'
          ? 'INTERNAL_DURABLE'
          : entry.source === 'gbrain-generated'
            ? 'PROJECT_LOCAL'
            : 'DORMANT_REFERENCE'),
      registryVersion,
      ...(path
        ? { contentSha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
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
