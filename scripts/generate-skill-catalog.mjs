#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(root, 'guidance/skills.registry.json'), 'utf8'));
const entries = registry.entries
  .map((entry) => {
    let description = entry.load.replaceAll('-', ' ');
    if (entry.source === 'major-internal') {
      const text = readFileSync(join(root, 'skills/internal', entry.id, 'SKILL.md'), 'utf8');
      description =
        text
          .match(/^description:\s*(.+)$/m)?.[1]
          ?.trim()
          .replace(/^['"]|['"]$/g, '') ?? description;
    }
    const contentSha256 =
      entry.source === 'major-internal'
        ? createHash('sha256')
            .update(readFileSync(join(root, 'skills/internal', entry.id, 'SKILL.md')))
            .digest('hex')
        : undefined;
    return {
      id: entry.id,
      title: entry.id
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' '),
      description,
      aliases: entry.aliases ?? [],
      availability: entry.availability,
      source: entry.source,
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
