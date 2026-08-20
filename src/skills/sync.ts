import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { majorHome } from '../supervisor/state.js';
import { cloneGitBranch } from '../resources/tools.js';

interface RegistryEntry {
  id: string;
  source: string;
  availability: string;
  load: string;
}

interface Registry {
  version: number;
  entries: RegistryEntry[];
}

export interface SkillSyncResult {
  sourceRoot: string;
  bundleId: string;
  registryVersion: number;
  activeBundle: string;
  internalSkillCount: number;
}

const DEFAULT_SKILLS_REPO_URL = 'https://github.com/ChukaDele/project-baracks.git';

function assertRegistry(value: unknown): Registry {
  if (!value || typeof value !== 'object') throw new Error('invalid Major skills registry');
  const record = value as { version?: unknown; entries?: unknown };
  if (!Number.isInteger(record.version) || Number(record.version) < 1 || !Array.isArray(record.entries)) {
    throw new Error('invalid Major skills registry schema');
  }
  const entries: RegistryEntry[] = record.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`invalid skill registry entry ${index}`);
    const row = entry as Record<string, unknown>;
    for (const field of ['id', 'source', 'availability', 'load'] as const) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') {
        throw new Error(`skill registry entry ${index} missing ${field}`);
      }
    }
    return {
      id: row.id as string,
      source: row.source as string,
      availability: row.availability as string,
      load: row.load as string,
    };
  });
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate Major skill ids in registry');
  return { version: Number(record.version), entries };
}

function filesBelow(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

function validateSource(sourceRoot: string): {
  registry: Registry;
  registryPath: string;
  internalRoot: string;
  evalRoot: string;
  internalIds: string[];
} {
  const registryPath = join(sourceRoot, 'guidance', 'skills.registry.json');
  const internalRoot = join(sourceRoot, 'skills', 'internal');
  const evalRoot = join(sourceRoot, 'evals', 'skill-resolver');
  for (const path of [registryPath, internalRoot, evalRoot]) {
    if (!existsSync(path)) throw new Error(`required skill-bundle source missing: ${path}`);
  }

  const registry = assertRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
  const registered = registry.entries
    .filter((entry) => entry.source === 'major-internal')
    .map((entry) => entry.id)
    .sort();
  const installed = readdirSync(internalRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(internalRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();

  const missing = registered.filter((id) => !installed.includes(id));
  const orphan = installed.filter((id) => !registered.includes(id));
  if (missing.length || orphan.length) {
    throw new Error(`skill registry/tree mismatch missing=${missing.join(',')} orphan=${orphan.join(',')}`);
  }

  for (const skillId of installed) {
    const text = readFileSync(join(internalRoot, skillId, 'SKILL.md'), 'utf8');
    if (!text.startsWith('---\n')) throw new Error(`${skillId}/SKILL.md missing frontmatter`);
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) throw new Error(`${skillId}/SKILL.md has malformed frontmatter`);
    const frontmatter = text.slice(4, end);
    const name = frontmatter.match(/^name:\s*(.+?)\s*$/m)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*(.+?)\s*$/m)?.[1]?.trim();
    if (name !== skillId) throw new Error(`${skillId}/SKILL.md frontmatter name mismatch`);
    if (!description) throw new Error(`${skillId}/SKILL.md missing description`);
  }

  const known = new Set(registry.entries.map((entry) => entry.id));
  for (const file of readdirSync(evalRoot).filter((name) => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(evalRoot, file), 'utf8')) as {
      skill?: unknown;
      should_trigger?: unknown;
      should_not_trigger?: unknown;
    };
    if (typeof parsed.skill !== 'string' || !known.has(parsed.skill)) {
      throw new Error(`resolver eval references unknown skill: ${file}`);
    }
    if (!Array.isArray(parsed.should_trigger) || !Array.isArray(parsed.should_not_trigger)) {
      throw new Error(`malformed resolver eval: ${file}`);
    }
  }

  return { registry, registryPath, internalRoot, evalRoot, internalIds: installed };
}

function bundleHash(sourceRoot: string, roots: string[]): string {
  const hash = createHash('sha256');
  const files = roots.flatMap((root) => filesBelow(root)).sort();
  for (const file of files) {
    hash.update(relative(sourceRoot, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function retainRollbackBundles(bundlesRoot: string, activeId: string): void {
  const rows = readdirSync(bundlesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== activeId && !entry.name.startsWith('.'))
    .map((entry) => {
      const path = join(bundlesRoot, entry.name);
      return { path, mtime: lstatSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtime - left.mtime);
  for (const row of rows.slice(2)) rmSync(row.path, { recursive: true, force: true });
}

function syncFromSource(sourceRootInput: string, sourceLabel?: string): SkillSyncResult {
  const sourceRoot = resolve(sourceRootInput);
  const validated = validateSource(sourceRoot);
  const bundleId = bundleHash(sourceRoot, [
    join(sourceRoot, 'guidance'),
    validated.internalRoot,
    validated.evalRoot,
  ]);

  const bundlesRoot = join(majorHome(), 'skill-bundles');
  const destination = join(bundlesRoot, bundleId);
  const staged = join(bundlesRoot, `.stage-${bundleId}-${process.pid}`);
  mkdirSync(bundlesRoot, { recursive: true, mode: 0o700 });
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(join(staged, 'guidance'), { recursive: true });
  mkdirSync(join(staged, 'skills'), { recursive: true });
  mkdirSync(join(staged, 'evals'), { recursive: true });
  cpSync(validated.registryPath, join(staged, 'guidance', 'skills.registry.json'));
  cpSync(validated.internalRoot, join(staged, 'skills', 'internal'), { recursive: true });
  cpSync(validated.evalRoot, join(staged, 'evals', 'skill-resolver'), { recursive: true });
  writeFileSync(
    join(staged, 'bundle.json'),
    `${JSON.stringify(
      {
        version: 1,
        sha: bundleId,
        registryVersion: validated.registry.version,
        source: sourceLabel ?? sourceRoot,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  rmSync(destination, { recursive: true, force: true });
  renameSync(staged, destination);
  const next = join(bundlesRoot, `.current-${process.pid}`);
  rmSync(next, { force: true });
  symlinkSync(basename(destination), next);
  renameSync(next, join(bundlesRoot, 'current'));
  retainRollbackBundles(bundlesRoot, bundleId);

  return {
    sourceRoot: sourceLabel ?? sourceRoot,
    bundleId,
    registryVersion: validated.registry.version,
    activeBundle: destination,
    internalSkillCount: validated.internalIds.length,
  };
}

/**
 * Sync the complete Major knowledge bundle. An explicit sourceRoot is useful
 * for local development and exact-checkout testing. Without one, fetch the
 * canonical origin/main into a temporary checkout so `major skill sync` works
 * from any directory and cannot silently reuse a stale local checkout.
 */
export function syncMajorSkills(input: { sourceRoot?: string } = {}): SkillSyncResult {
  const explicitSource = input.sourceRoot ?? process.env.MAJOR_SKILLS_SOURCE;
  if (explicitSource) return syncFromSource(explicitSource);

  const repoUrl = process.env.MAJOR_SKILLS_REPO_URL ?? DEFAULT_SKILLS_REPO_URL;
  const tempRoot = mkdtempSync(join(tmpdir(), 'major-skill-sync-'));
  const checkout = join(tempRoot, 'source');
  try {
    cloneGitBranch({
      repoUrl,
      branch: 'main',
      destination: checkout,
    });
    return syncFromSource(checkout, `${repoUrl}#main`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
