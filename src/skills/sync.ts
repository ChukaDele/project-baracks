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
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { majorHome } from '../supervisor/state.js';
import { cloneGitBranch } from '../resources/tools.js';
import { buildSkillCatalog } from './catalog.js';
import {
  findVendorSkill,
  loadVendorCatalog,
  SKILL_SOURCE_KINDS,
  type SkillSourceKind,
} from './vendor.js';

interface RegistryEntry {
  id: string;
  source: string;
  sourceKind?: SkillSourceKind;
  vendorSkill?: string;
  availability: string;
  load: string;
  aliases: string[];
  disclosure: 'hot' | 'specialist';
  deprecated?: { replacement?: string; message?: string };
}

interface Registry {
  version: number;
  entries: RegistryEntry[];
}

interface BundleMarker {
  version: 1;
  sha: string;
  previousBundle?: string;
}

export interface SkillSyncResult {
  sourceRoot: string;
  bundleId: string;
  registryVersion: number;
  activeBundle: string;
  internalSkillCount: number;
  vendorSkillCount: number;
}

export interface SkillRollbackResult {
  previousBundle: string;
  activeBundle: string;
  bundleId: string;
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
    if (
      row.disclosure !== undefined &&
      row.disclosure !== 'hot' &&
      row.disclosure !== 'specialist'
    ) {
      throw new Error(`skill registry entry ${index} has invalid disclosure tier`);
    }
    if (
      row.aliases !== undefined &&
      (!Array.isArray(row.aliases) || !row.aliases.every((alias) => typeof alias === 'string'))
    ) {
      throw new Error(`skill registry entry ${index} has invalid aliases`);
    }
    if (
      row.sourceKind !== undefined &&
      (typeof row.sourceKind !== 'string' ||
        !SKILL_SOURCE_KINDS.includes(row.sourceKind as SkillSourceKind))
    ) {
      throw new Error(`skill registry entry ${index} has invalid source kind`);
    }
    if (row.vendorSkill !== undefined && typeof row.vendorSkill !== 'string') {
      throw new Error(`skill registry entry ${index} has invalid vendor skill id`);
    }
    return {
      id: row.id as string,
      source: row.source as string,
      ...(typeof row.sourceKind === 'string'
        ? { sourceKind: row.sourceKind as SkillSourceKind }
        : {}),
      ...(typeof row.vendorSkill === 'string' ? { vendorSkill: row.vendorSkill } : {}),
      availability: row.availability as string,
      load: row.load as string,
      aliases:
        Array.isArray(row.aliases) && row.aliases.every((alias) => typeof alias === 'string')
          ? row.aliases
          : [],
      disclosure:
        row.disclosure === 'hot' || row.disclosure === 'specialist'
          ? row.disclosure
          : 'specialist',
      ...(row.deprecated && typeof row.deprecated === 'object'
        ? {
            deprecated: {
              ...('replacement' in row.deprecated &&
              typeof row.deprecated.replacement === 'string'
                ? { replacement: row.deprecated.replacement }
                : {}),
              ...('message' in row.deprecated && typeof row.deprecated.message === 'string'
                ? { message: row.deprecated.message }
                : {}),
            },
          }
        : {}),
    };
  });
  const ids = entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate Major skill ids in registry');
  return { version: Number(record.version), entries };
}

function readBundleMarker(path: string): BundleMarker {
  const value = JSON.parse(readFileSync(join(path, 'bundle.json'), 'utf8')) as Record<string, unknown>;
  if (
    value.version !== 1 ||
    typeof value.sha !== 'string' ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.sha) ||
    (value.previousBundle !== undefined &&
      (typeof value.previousBundle !== 'string' ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.previousBundle)))
  ) {
    throw new Error('invalid Major Skills Library bundle marker');
  }
  return {
    version: 1,
    sha: value.sha,
    ...(typeof value.previousBundle === 'string' ? { previousBundle: value.previousBundle } : {}),
  };
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
  catalogPath: string;
  reconciliationLedgerPath: string;
  sourceLedgerPath: string;
  capabilityMatrixPath: string;
  vendorSourcePath: string;
  internalRoot: string;
  evalRoot: string;
  adaptersRoot: string;
  internalIds: string[];
  assetPaths: string[];
} {
  const registryPath = join(sourceRoot, 'guidance', 'skills.registry.json');
  const catalogPath = join(sourceRoot, 'guidance', 'skills.catalog.json');
  const reconciliationLedgerPath = join(sourceRoot, 'guidance', 'skills-reconciliation-ledger.json');
  const sourceLedgerPath = join(sourceRoot, 'package', 'source-ledger.json');
  const capabilityMatrixPath = join(sourceRoot, 'guidance', 'worker-capability-matrix.json');
  const vendorSourcePath = join(sourceRoot, 'guidance', 'vendor-sources.json');
  const internalRoot = join(sourceRoot, 'skills', 'internal');
  const evalRoot = join(sourceRoot, 'evals', 'skill-resolver');
  const adaptersRoot = join(sourceRoot, 'adapters', 'skills');
  const assetRegistryPath = join(sourceRoot, 'guidance', 'reusable-assets.registry.json');
  for (const path of [
    registryPath,
    catalogPath,
    reconciliationLedgerPath,
    sourceLedgerPath,
    capabilityMatrixPath,
    vendorSourcePath,
    assetRegistryPath,
    internalRoot,
    evalRoot,
    adaptersRoot,
  ]) {
    if (!existsSync(path)) throw new Error(`required skill-bundle source missing: ${path}`);
  }

  const sourceLedger = JSON.parse(readFileSync(sourceLedgerPath, 'utf8')) as {
    schemaVersion?: unknown;
    sourceLockDate?: unknown;
    sources?: unknown;
  };
  if (
    !Number.isInteger(sourceLedger.schemaVersion) ||
    typeof sourceLedger.sourceLockDate !== 'string' ||
    !Array.isArray(sourceLedger.sources)
  ) {
    throw new Error('invalid Major Skills Library source ledger');
  }

  const registry = assertRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    version?: unknown;
    registryVersion?: unknown;
    entries?: Array<{ id?: unknown }>;
  };
  const expectedCatalog = buildSkillCatalog(
    registry.entries,
    (entry) =>
      entry.source === 'major-internal'
        ? join(internalRoot, entry.id, 'SKILL.md')
        : undefined,
    registry.version,
  );
  if (
    catalog.version !== 1 ||
    catalog.registryVersion !== registry.version ||
    JSON.stringify(catalog.entries) !== JSON.stringify(expectedCatalog)
  ) {
    throw new Error('generated skill catalog does not match the canonical registry');
  }
  const vendorCatalog = loadVendorCatalog(vendorSourcePath);
  for (const entry of registry.entries.filter((candidate) => candidate.sourceKind === 'VENDOR_LIVE')) {
    const source = vendorCatalog.sources.find((candidate) => candidate.id === entry.source);
    const skill = source ? findVendorSkill(source, entry.vendorSkill ?? entry.id) : undefined;
    if (!source || !skill) {
      throw new Error(`vendor registry entry is not present in the vendor catalog: ${entry.id}`);
    }
  }
  const reconciliationLedger = JSON.parse(readFileSync(reconciliationLedgerPath, 'utf8')) as {
    entries?: unknown;
  };
  if (!Array.isArray(reconciliationLedger.entries)) {
    throw new Error('invalid Major Skills Library reconciliation ledger');
  }
  const assetCatalog = JSON.parse(readFileSync(assetRegistryPath, 'utf8')) as {
    version?: unknown;
    assets?: unknown;
  };
  if (!Number.isInteger(assetCatalog.version) || !Array.isArray(assetCatalog.assets)) {
    throw new Error('invalid reusable asset registry schema');
  }
  const assetIds = new Set<string>();
  for (const [index, value] of assetCatalog.assets.entries()) {
    if (!value || typeof value !== 'object') throw new Error(`invalid reusable asset ${index}`);
    const asset = value as Record<string, unknown>;
    for (const field of ['id', 'kind', 'title', 'summary', 'locator'] as const) {
      if (typeof asset[field] !== 'string' || asset[field].trim() === '') {
        throw new Error(`reusable asset ${index} missing ${field}`);
      }
    }
    if (
      typeof asset.lifecycle !== 'string' ||
      !['LOCAL', 'REUSE_CANDIDATE', 'EVALUATED', 'PROMOTED', 'MONITORED', 'UPDATED', 'DEPRECATED'].includes(asset.lifecycle) ||
      !Array.isArray(asset.tags) ||
      !asset.provenance ||
      !asset.evidence
    ) {
      throw new Error(`reusable asset ${index} has incomplete lifecycle metadata`);
    }
    if (assetIds.has(asset.id as string)) throw new Error('duplicate reusable asset ids');
    assetIds.add(asset.id as string);
    const target = resolve(sourceRoot, asset.locator as string);
    if (!target.startsWith(`${sourceRoot}${sep}`) || !existsSync(target)) {
      throw new Error(`reusable asset locator is unavailable or escapes source: ${asset.locator as string}`);
    }
    if (!realpathSync(target).startsWith(`${realpathSync(sourceRoot)}${sep}`)) {
      throw new Error(`reusable asset locator escapes source through a symlink: ${asset.locator as string}`);
    }
  }
  const assetPaths = assetCatalog.assets.map((asset) =>
    resolve(sourceRoot, (asset as Record<string, unknown>).locator as string),
  );
  for (const name of ['gbrain-reusable-assets.index.json', 'reusable-assets.candidates.json']) {
    if (!existsSync(join(sourceRoot, 'guidance', name))) {
      throw new Error(`required reusable asset metadata missing: ${name}`);
    }
  }
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
    const document = parseDocument(text.slice(4, end));
    if (document.errors.length) {
      throw new Error(`${skillId}/SKILL.md has invalid YAML frontmatter: ${document.errors[0]?.message}`);
    }
    const frontmatter: unknown = document.toJS();
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      throw new Error(`${skillId}/SKILL.md frontmatter must be a mapping`);
    }
    const fields = frontmatter as Record<string, unknown>;
    if (fields.name !== skillId) throw new Error(`${skillId}/SKILL.md frontmatter name mismatch`);
    if (typeof fields.description !== 'string' || !fields.description.trim()) {
      throw new Error(`${skillId}/SKILL.md missing description`);
    }
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

  return {
    registry,
    registryPath,
    catalogPath,
    reconciliationLedgerPath,
    sourceLedgerPath,
    capabilityMatrixPath,
    vendorSourcePath,
    internalRoot,
    evalRoot,
    adaptersRoot,
    internalIds: installed,
    assetPaths,
  };
}

function writeAtomicFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, content);
  renameSync(staged, path);
}

function activateHostSkillArtifacts(
  catalogPath: string,
  adaptersRoot: string,
): void {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
    entries: Array<{ id: string }>;
  };
  const home =
    process.env.NODE_ENV === 'test' && process.env.MAJOR_HOME
      ? dirname(majorHome())
      : process.env.HOME;
  if (!home) throw new Error('HOME is required to activate hot-synced skill host artifacts');
  const codexHome =
    process.env.NODE_ENV === 'test' && process.env.MAJOR_HOME
      ? join(home, '.codex')
      : (process.env.CODEX_HOME ?? join(home, '.codex'));
  writeAtomicFile(join(majorHome(), 'skills.catalog.json'), readFileSync(catalogPath, 'utf8'));
  for (const [source, target] of [
    ['CLAUDE.md', join(home, '.claude', 'MAJOR_SKILLS.md')],
    ['CODEX.md', join(codexHome, 'MAJOR_SKILLS.md')],
    ['GEMINI.md', join(home, '.gemini', 'MAJOR_SKILLS.md')],
    ['RULE.mdc', join(home, '.cursor', 'rules', 'major-skills', 'RULE.mdc')],
  ] as const) writeAtomicFile(target, readFileSync(join(adaptersRoot, source), 'utf8'));

  const markdownRoots = [
    join(home, '.claude', 'commands'),
    join(codexHome, 'prompts'),
    join(home, '.cursor', 'commands'),
  ];
  const discovery = 'Use the installed Major catalogue. Run `major skill search --query "$ARGUMENTS"` or `major skill resolve --task "$ARGUMENTS" --json`.\n';
  for (const root of markdownRoots) {
    writeAtomicFile(join(root, 'major.md'), discovery);
    const staged = join(root, `.major-${process.pid}`);
    rmSync(staged, { recursive: true, force: true });
    mkdirSync(staged, { recursive: true });
    for (const { id } of catalog.entries) {
      writeFileSync(join(staged, `${id}.md`), `Run \`major skill resolve --task "$ARGUMENTS" --skill ${id} --json\`; the named skill is mandatory.\n`);
    }
    const target = join(root, 'major');
    rmSync(target, { recursive: true, force: true });
    renameSync(staged, target);
  }
  const geminiRoot = join(home, '.gemini', 'commands');
  writeAtomicFile(join(geminiRoot, 'major.toml'), 'description = "Discover Major skills"\nprompt = "Run `major skill search --query {{args}}`."\n');
  const geminiStage = join(geminiRoot, `.major-${process.pid}`);
  rmSync(geminiStage, { recursive: true, force: true });
  mkdirSync(geminiStage, { recursive: true });
  for (const { id } of catalog.entries) {
    writeFileSync(join(geminiStage, `${id}.toml`), `description = "Invoke Major skill ${id}"\nprompt = "Run \`major skill resolve --task {{args}} --skill ${id} --json\`."\n`);
  }
  const geminiTarget = join(geminiRoot, 'major');
  rmSync(geminiTarget, { recursive: true, force: true });
  renameSync(geminiStage, geminiTarget);
}

function bundleHash(sourceRoot: string, roots: string[]): string {
  const hash = createHash('sha256');
  const files = roots
    .flatMap((root) => (lstatSync(root).isDirectory() ? filesBelow(root) : [root]))
    .sort();
  for (const file of files) {
    hash.update(relative(sourceRoot, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function retainRollbackBundles(
  bundlesRoot: string,
  activeId: string,
  previousBundle?: string,
): void {
  const rows = readdirSync(bundlesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        entry.name !== activeId &&
        !entry.name.startsWith('.'),
    )
    .map((entry) => {
      const path = join(bundlesRoot, entry.name);
      try {
        return { path, marker: readBundleMarker(path), mtime: lstatSync(path).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((row): row is { path: string; marker: BundleMarker; mtime: number } => Boolean(row))
    .sort((left, right) => right.mtime - left.mtime);
  const retained = [
    ...rows.filter((row) => row.marker.sha === previousBundle),
    ...rows.filter((row) => row.marker.sha !== previousBundle),
  ].slice(0, 2);
  const keep = new Set(retained.map((row) => row.path));
  for (const row of rows) {
    if (!keep.has(row.path)) rmSync(row.path, { recursive: true, force: true });
  }
}

function syncFromSource(sourceRootInput: string, sourceLabel?: string): SkillSyncResult {
  const sourceRoot = resolve(sourceRootInput);
  const validated = validateSource(sourceRoot);
  const bundleId = bundleHash(sourceRoot, [
    join(sourceRoot, 'guidance'),
    validated.sourceLedgerPath,
    validated.internalRoot,
    validated.evalRoot,
    validated.adaptersRoot,
    ...validated.assetPaths,
  ]);

  const bundlesRoot = join(majorHome(), 'skill-bundles');
  const destination = join(bundlesRoot, bundleId);
  const staged = join(bundlesRoot, `.stage-${bundleId}-${process.pid}`);
  mkdirSync(bundlesRoot, { recursive: true, mode: 0o700 });
  const current = join(bundlesRoot, 'current');
  let previousBundle: string | undefined;
  if (existsSync(current)) {
    try {
      previousBundle = readBundleMarker(realpathSync(current)).sha;
    } catch {
      // A malformed predecessor is not retained or referenced by a new bundle.
    }
  }
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(join(staged, 'guidance'), { recursive: true });
  mkdirSync(join(staged, 'package'), { recursive: true });
  mkdirSync(join(staged, 'skills'), { recursive: true });
  mkdirSync(join(staged, 'evals'), { recursive: true });
  mkdirSync(join(staged, 'adapters'), { recursive: true });
  cpSync(validated.registryPath, join(staged, 'guidance', 'skills.registry.json'));
  cpSync(validated.catalogPath, join(staged, 'guidance', 'skills.catalog.json'));
  cpSync(
    validated.reconciliationLedgerPath,
    join(staged, 'guidance', 'skills-reconciliation-ledger.json'),
  );
  cpSync(validated.capabilityMatrixPath, join(staged, 'guidance', 'worker-capability-matrix.json'));
  cpSync(validated.vendorSourcePath, join(staged, 'guidance', 'vendor-sources.json'));
  cpSync(validated.sourceLedgerPath, join(staged, 'package', 'source-ledger.json'));
  cpSync(
    join(sourceRoot, 'guidance', 'reusable-assets.registry.json'),
    join(staged, 'guidance', 'reusable-assets.registry.json'),
  );
  cpSync(
    join(sourceRoot, 'guidance', 'gbrain-reusable-assets.index.json'),
    join(staged, 'guidance', 'gbrain-reusable-assets.index.json'),
  );
  cpSync(
    join(sourceRoot, 'guidance', 'reusable-assets.candidates.json'),
    join(staged, 'guidance', 'reusable-assets.candidates.json'),
  );
  for (const path of validated.assetPaths) {
    const destination = join(staged, relative(sourceRoot, path));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(path, destination);
  }
  cpSync(validated.internalRoot, join(staged, 'skills', 'internal'), { recursive: true });
  cpSync(validated.evalRoot, join(staged, 'evals', 'skill-resolver'), { recursive: true });
  cpSync(validated.adaptersRoot, join(staged, 'adapters', 'skills'), { recursive: true });
  writeFileSync(
    join(staged, 'bundle.json'),
    `${JSON.stringify(
      {
        version: 1,
        sha: bundleId,
        registryVersion: validated.registry.version,
        source: sourceLabel ?? sourceRoot,
        installedAt: new Date().toISOString(),
        ...(previousBundle ? { previousBundle } : {}),
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
  activateHostSkillArtifacts(
    join(destination, 'guidance', 'skills.catalog.json'),
    join(destination, 'adapters', 'skills'),
  );
  retainRollbackBundles(bundlesRoot, bundleId, previousBundle);

  return {
    sourceRoot: sourceLabel ?? sourceRoot,
    bundleId,
    registryVersion: validated.registry.version,
    activeBundle: destination,
    internalSkillCount: validated.internalIds.length,
    vendorSkillCount: validated.registry.entries.filter(
      (entry) => entry.sourceKind === 'VENDOR_LIVE',
    ).length,
  };
}

/** Atomically reactivate the exact predecessor recorded by the active bundle. */
export function rollbackMajorSkills(): SkillRollbackResult {
  const bundlesRoot = join(majorHome(), 'skill-bundles');
  const current = join(bundlesRoot, 'current');
  if (!existsSync(current)) throw new Error('no active Major Skills Library bundle');
  const active = realpathSync(current);
  const activeMarker = readBundleMarker(active);
  const candidates = readdirSync(bundlesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map((entry) => join(bundlesRoot, entry.name))
    .filter((path) => realpathSync(path) !== active)
    .map((path) => {
      if (
        !existsSync(join(path, 'guidance', 'skills.registry.json')) ||
        !existsSync(join(path, 'skills', 'internal'))
      ) {
        return undefined;
      }
      try {
        return { path, marker: readBundleMarker(path), mtime: lstatSync(path).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((row): row is { path: string; marker: BundleMarker; mtime: number } => Boolean(row))
    .sort((left, right) => right.mtime - left.mtime);
  const target =
    candidates.find((candidate) => candidate.marker.sha === activeMarker.previousBundle) ?? candidates[0];
  if (!target) throw new Error('no retained Major Skills Library rollback bundle');
  const next = join(bundlesRoot, `.current-rollback-${process.pid}`);
  rmSync(next, { force: true });
  symlinkSync(basename(target.path), next);
  renameSync(next, current);
  return { previousBundle: active, activeBundle: target.path, bundleId: target.marker.sha };
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
