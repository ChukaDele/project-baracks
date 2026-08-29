#!/usr/bin/env node
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
      triggers: entry.load.split('-').filter(Boolean),
      ...(entry.deprecated ? { deprecated: entry.deprecated } : {}),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(
  join(root, 'guidance/skills.catalog.json'),
  `${JSON.stringify({ version: 1, registryVersion: registry.version, entries }, null, 2)}\n`,
);

const instruction = `# Major skill invocation\n\nThe installed catalogue is \`~/.major/skills.catalog.json\` (managed projects also expose \`.agents/skills.catalog.json\`). Discover skills with \`major skill search --query "<need>"\`. Explicit invocation is \`major skill resolve --task "<task>" --skill <id>\`; repeat \`--skill\` to compose skills. Every requested skill is mandatory: unknown, deprecated, or unavailable selections fail clearly. Omit \`--skill\` to preserve automatic resolution. Inspect the JSON receipt with \`--json\`.\n`;
mkdirSync(join(root, 'adapters/skills'), { recursive: true });
for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md'])
  writeFileSync(join(root, 'adapters/skills', name), instruction);
writeFileSync(
  join(root, 'adapters/skills/RULE.mdc'),
  `---\ndescription: Major skill discoverability and explicit invocation\nalwaysApply: true\n---\n\n${instruction}`,
);
