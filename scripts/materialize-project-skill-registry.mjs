#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const [command, rootArg, targetArg, profile, featuresArg = '', locksArg = ''] =
  process.argv.slice(2);
if (!['plan', 'materialize'].includes(command) || !rootArg || !targetArg || !profile)
  throw new Error(
    'usage: materialize-project-skill-registry.mjs plan|materialize ROOT TARGET PROFILE [FEATURES] [LOCKS]',
  );
const root = resolve(rootArg);
const target = resolve(targetArg);
const registry = JSON.parse(readFileSync(join(root, 'guidance/skills.registry.json'), 'utf8'));
const canonicalCatalog = JSON.parse(
  readFileSync(join(root, 'guidance/skills.catalog.json'), 'utf8'),
);
const features = new Set(featuresArg.split(',').filter(Boolean));
const eligible = (contract) =>
  contract.profiles.includes(profile) ||
  (contract.features ?? []).some((feature) => features.has(feature));
const contracts = registry.entries.filter(
  (entry) => entry.projectInstall && eligible(entry.projectInstall),
);

if (command === 'plan') {
  for (const entry of contracts) {
    const contract = entry.projectInstall;
    for (const value of [entry.id, contract.sourceKey])
      if (!slug.test(value)) throw new Error(`unsafe project install slug: ${value}`);
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(contract.repository))
      throw new Error(`invalid project install repository: ${entry.id}`);
    const members = contract.mode === 'bundle' ? contract.members : [entry.id];
    for (const id of members) {
      const skillPath =
        contract.mode === 'bundle'
          ? contract.skillPathPattern.replace('{id}', id)
          : contract.skillPath;
      if (!slug.test(id) || skillPath !== `skills/${id}`)
        throw new Error(`invalid project install member/path: ${id}`);
      process.stdout.write(
        [contract.sourceKey, contract.repository, id, skillPath].join('\t') + '\n',
      );
    }
  }
  process.exit(0);
}

const locks = new Map();
for (const row of locksArg.split(';').filter(Boolean)) {
  const [key, repository, commit] = row.split('|');
  if (!key || !repository || !/^[0-9a-f]{40}$/.test(commit ?? ''))
    throw new Error('invalid source lock');
  locks.set(key, { repository, commit });
}
const internalEntries = registry.entries.filter((entry) => entry.source === 'major-internal');
const managedRoot = join(target, '.agents', 'skills');
const managedSources = new Map(
  readFileSync(join(target, '.agents', 'managed-external.tsv'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [id, sourceKey, skillPath] = row.split('\t');
      return [id, { sourceKey, skillPath }];
    }),
);
const installed = new Map();
for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !existsSync(join(managedRoot, entry.name, 'SKILL.md'))) continue;
  if (internalEntries.some((candidate) => candidate.id === entry.name)) continue;
  installed.set(entry.name, join(managedRoot, entry.name));
}
const expectedManagedIds = new Set(
  contracts.flatMap((entry) =>
    entry.projectInstall.mode === 'bundle' ? entry.projectInstall.members : [entry.id],
  ),
);
if (
  managedSources.size !== expectedManagedIds.size ||
  [...managedSources].some(([id]) => !expectedManagedIds.has(id))
)
  throw new Error('installed managed skill set is not bound to the canonical registry');
const externalEntries = [];
for (const contractEntry of contracts) {
  const contract = contractEntry.projectInstall;
  const lock = locks.get(contract.sourceKey);
  if (!lock || lock.repository !== contract.repository)
    throw new Error(`missing truthful source lock: ${contractEntry.id}`);
  const ids = contract.mode === 'bundle' ? contract.members : [contractEntry.id];
  for (const id of ids) {
    const skillPath =
      contract.mode === 'bundle'
        ? contract.skillPathPattern.replace('{id}', id)
        : contract.skillPath;
    const managed = managedSources.get(id);
    if (
      !slug.test(id) ||
      !installed.has(id) ||
      managed?.sourceKey !== contract.sourceKey ||
      managed.skillPath !== skillPath
    )
      throw new Error(`missing or unsafe installed managed skill: ${id}`);
    const canonical = contract.mode === 'bundle' ? contractEntry : contractEntry;
    const contentSha256 = contentHash(installed.get(id));
    externalEntries.push({
      id,
      source: canonical.source,
      sourceKind: 'PROJECT_LOCAL',
      availability: canonical.availability,
      load: contract.mode === 'bundle' ? id : canonical.load,
      aliases: [],
      disclosure: canonical.disclosure ?? 'specialist',
      version: `project-content-sha256:${contentSha256}`,
      provenance: {
        kind: 'project-installed-local-content',
        verification: 'metadata-only',
        repository: lock.repository,
        assertedCheckoutCommit: lock.commit,
        bundle: contractEntry.id,
        skillPath,
        contentIdentity: { type: 'sha256', value: contentSha256, scope: 'project-installed' },
      },
    });
  }
}
if (new Set(externalEntries.map((entry) => entry.id)).size !== externalEntries.length)
  throw new Error('duplicate managed external skill id');

function contentHash(path) {
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(dir, item.name);
      if (item.isDirectory()) walk(child);
      else if (item.isFile()) files.push(child);
      else throw new Error(`unsupported skill content: ${child}`);
    }
  };
  walk(path);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(path, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
const projectRegistry = {
  version: registry.version,
  projectProjection: {
    profile,
    features: [...features].sort(),
    canonicalRegistryVersion: registry.version,
    sources: [...locks.entries()].sort().map(([sourceKey, lock]) => ({ sourceKey, ...lock })),
  },
  entries: [...internalEntries, ...externalEntries].sort((a, b) => a.id.localeCompare(b.id)),
};
const canonicalById = new Map(canonicalCatalog.entries.map((entry) => [entry.id, entry]));
const catalogEntries = projectRegistry.entries
  .map((entry) => {
    if (entry.source === 'major-internal') return canonicalById.get(entry.id);
    const path = installed.get(entry.id);
    const description =
      readFileSync(join(path, 'SKILL.md'), 'utf8')
        .match(/^description:\s*(.+)$/m)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, '') ?? entry.load.replaceAll('-', ' ');
    return {
      id: entry.id,
      name: entry.id,
      title: entry.id
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' '),
      description,
      shortDescription: description,
      aliases: [],
      triggerConditions: [entry.load],
      category: 'external',
      version: String(entry.version),
      lifecycle: 'active',
      availability: entry.availability,
      applicableProjects: [entry.availability],
      source: entry.source,
      provenance: entry.provenance,
      dependencies: [],
      sourceKind: entry.sourceKind,
      registryVersion: registry.version,
      contentSha256: contentHash(path),
      triggers: entry.load.split('-').filter(Boolean),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
if (catalogEntries.some((entry) => !entry))
  throw new Error('canonical internal catalogue entry missing');
writeFileSync(
  join(target, '.agents', 'skills.registry.json'),
  JSON.stringify(projectRegistry, null, 2) + '\n',
);
writeFileSync(
  join(target, '.agents', 'skills.catalog.json'),
  JSON.stringify(
    {
      version: 1,
      registryVersion: registry.version,
      projectProjection: projectRegistry.projectProjection,
      entries: catalogEntries,
    },
    null,
    2,
  ) + '\n',
);
