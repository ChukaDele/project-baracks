#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const canonicalSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function assertSlug(value, label) {
  if (typeof value !== 'string' || !canonicalSlug.test(value))
    throw new Error(`${label} must be a safe canonical slug: ${JSON.stringify(value)}`);
}
function containedSkillRoot(id) {
  assertSlug(id, 'skill registry id');
  const internal = resolve(root, 'skills/internal');
  const target = resolve(internal, id);
  if (!target.startsWith(`${internal}${sep}`))
    throw new Error(`skill path escapes internal root: ${id}`);
  return target;
}
function skillContentSha256(skillRoot) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`unsupported skill content entry: ${relative(skillRoot, path)}`);
    }
  };
  walk(skillRoot);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(skillRoot, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
const registry = JSON.parse(readFileSync(join(root, 'guidance/skills.registry.json'), 'utf8'));
if (!Number.isInteger(registry.version) || !Array.isArray(registry.entries))
  throw new Error('invalid canonical skill registry');
const owners = new Map();
for (const entry of registry.entries) {
  assertSlug(entry.id, 'skill registry id');
  if (entry.aliases !== undefined && !Array.isArray(entry.aliases))
    throw new Error(`invalid aliases for ${entry.id}`);
  for (const slug of [entry.id, ...(entry.aliases ?? [])]) {
    assertSlug(slug, `skill registry ${entry.id} alias`);
    if (owners.has(slug) && owners.get(slug) !== entry.id)
      throw new Error(`duplicate skill id or alias ${JSON.stringify(slug)}`);
    owners.set(slug, entry.id);
  }
}
const knownIds = new Set(registry.entries.map((entry) => entry.id));
const entries = registry.entries
  .map((entry) => {
    let description = entry.load.replaceAll('-', ' ');
    if (entry.source === 'major-internal') {
      const text = readFileSync(join(containedSkillRoot(entry.id), 'SKILL.md'), 'utf8');
      description =
        text
          .match(/^description:\s*(.+)$/m)?.[1]
          ?.trim()
          .replace(/^['"]|['"]$/g, '') ?? description;
    }
    const contentSha256 =
      entry.source === 'major-internal'
        ? skillContentSha256(containedSkillRoot(entry.id))
        : undefined;
    const sourceText =
      entry.source === 'major-internal'
        ? readFileSync(join(containedSkillRoot(entry.id), 'SKILL.md'), 'utf8')
        : '';
    const dependencies = [
      ...(entry.dependencies ?? []),
      ...[...knownIds].filter((id) => id !== entry.id && sourceText.includes(id)),
    ].filter((id, index, all) => all.indexOf(id) === index);
    return {
      id: entry.id,
      name: entry.id,
      title: entry.id
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' '),
      description,
      shortDescription: description,
      aliases: entry.aliases ?? [],
      triggerConditions: [entry.load],
      category: entry.category ?? 'uncategorized',
      version: String(entry.version ?? registry.version),
      lifecycle: entry.deprecated ? 'deprecated' : entry.experimental ? 'experimental' : 'active',
      availability: entry.availability,
      applicableProjects: [entry.availability],
      source: entry.source,
      provenance: entry.provenance ?? {
        kind: 'canonical-registry',
        registryVersion: registry.version,
      },
      dependencies,
      sourceKind:
        entry.sourceKind ??
        (entry.source === 'major-internal'
          ? 'INTERNAL_DURABLE'
          : entry.source === 'gbrain-generated'
            ? 'PROJECT_LOCAL'
            : 'DORMANT_REFERENCE'),
      registryVersion: registry.version,
      ...(contentSha256 ? { contentSha256 } : {}),
      triggers: entry.load.split('-').filter(Boolean),
      ...(entry.deprecated ? { deprecated: entry.deprecated } : {}),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const catalogText = `${JSON.stringify({ version: 1, registryVersion: registry.version, entries }, null, 2)}\n`;
const catalogPath = join(root, 'guidance/skills.catalog.json');
if (process.argv.includes('--check')) {
  if (readFileSync(catalogPath, 'utf8') !== catalogText)
    throw new Error('generated skill catalogue is stale; run pnpm generate:skill-catalog');
} else writeFileSync(catalogPath, catalogText);

const instruction = `# Major skill invocation\n\nThe installed catalogue is \`~/.major/skills.catalog.json\` (managed projects also expose \`.agents/skills.catalog.json\`). Discover skills with \`major skill search --query "<need>"\`. Explicit invocation is \`major skill resolve --task "<task>" --skill <id>\`; repeat \`--skill\` to compose skills. Every requested skill is mandatory: unknown, deprecated, or unavailable selections fail clearly. Omit \`--skill\` to preserve automatic resolution. Inspect the JSON receipt with \`--json\`.\n`;
mkdirSync(join(root, 'adapters/skills'), { recursive: true });
for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md'])
  if (!process.argv.includes('--check'))
    writeFileSync(join(root, 'adapters/skills', name), instruction);
const ruleText = `---\ndescription: Major skill discoverability and explicit invocation\nalwaysApply: true\n---\n\n${instruction}`;
if (!process.argv.includes('--check'))
  writeFileSync(join(root, 'adapters/skills/RULE.mdc'), ruleText);
else {
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md']) {
    if (readFileSync(join(root, 'adapters/skills', name), 'utf8') !== instruction)
      throw new Error(`generated skill adapter is stale: ${name}`);
  }
  if (readFileSync(join(root, 'adapters/skills/RULE.mdc'), 'utf8') !== ruleText)
    throw new Error('generated skill adapter is stale: RULE.mdc');
}
