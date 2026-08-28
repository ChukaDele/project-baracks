import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';

const root = resolve(process.cwd());
const registryPath = join(root, 'guidance', 'skills.registry.json');
const reconciliationLedgerPath = join(root, 'guidance', 'skills-reconciliation-ledger.json');
const sourceLedgerPath = join(root, 'package', 'source-ledger.json');
const capabilityMatrixPath = join(root, 'guidance', 'worker-capability-matrix.json');
const assetRegistryPath = join(root, 'guidance', 'reusable-assets.registry.json');
const gbrainIndexPath = join(root, 'guidance', 'gbrain-reusable-assets.index.json');
const candidatePath = join(root, 'guidance', 'reusable-assets.candidates.json');
const internalRoot = join(root, 'skills', 'internal');
const evalRoot = join(root, 'evals', 'skill-resolver');
const lifecycles = new Set([
  'LOCAL',
  'REUSE_CANDIDATE',
  'EVALUATED',
  'PROMOTED',
  'MONITORED',
  'UPDATED',
  'DEPRECATED',
]);

function fail(message) {
  throw new Error(`Major skill validation failed: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object`);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  return value.trim();
}

function list(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${label} must be a non-empty-string array`);
  }
  return value;
}

function inside(path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function validateSkill(skillId) {
  const path = join(internalRoot, skillId, 'SKILL.md');
  const source = readFileSync(path, 'utf8');
  if (!source.startsWith('---\n')) fail(`${skillId}/SKILL.md must begin with YAML frontmatter`);
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) fail(`${skillId}/SKILL.md has no closing YAML frontmatter delimiter`);
  const document = parseDocument(source.slice(4, end));
  if (document.errors.length) {
    fail(`${skillId}/SKILL.md YAML: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const frontmatter = object(document.toJS(), `${skillId}/SKILL.md frontmatter`);
  if (nonEmpty(frontmatter.name, `${skillId}/SKILL.md name`) !== skillId) {
    fail(`${skillId}/SKILL.md frontmatter name must match directory`);
  }
  nonEmpty(frontmatter.description, `${skillId}/SKILL.md description`);
}

function validateAsset(asset, label, requireLocator = true) {
  const value = object(asset, label);
  const id = nonEmpty(value.id, `${label}.id`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${label}.id is invalid`);
  for (const key of ['kind', 'title', 'summary']) nonEmpty(value[key], `${label}.${key}`);
  if (requireLocator) {
    const locator = nonEmpty(value.locator, `${label}.locator`);
    const target = resolve(root, locator);
    if (!inside(target) || !existsSync(target))
      fail(`${label}.locator is unavailable or escapes this repository`);
  }
  list(value.tags, `${label}.tags`);
  if (!lifecycles.has(value.lifecycle)) fail(`${label}.lifecycle is invalid`);
  if (!['shared', 'project-local'].includes(value.scope)) fail(`${label}.scope is invalid`);
  return value;
}

const registry = object(JSON.parse(readFileSync(registryPath, 'utf8')), 'skills registry');
if (!Number.isInteger(registry.version) || !Array.isArray(registry.entries))
  fail('skills registry schema is invalid');
const registered = registry.entries
  .filter((entry) => object(entry, 'skill registry entry').source === 'major-internal')
  .map((entry) => nonEmpty(entry.id, 'skill registry entry id'));
if (new Set(registered).size !== registered.length)
  fail('skills registry has duplicate internal ids');
const installed = readdirSync(internalRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(internalRoot, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();
if (registered.slice().sort().join('\n') !== installed.join('\n'))
  fail('skills registry and internal skill tree differ');
for (const id of installed) validateSkill(id);

const sourceLedger = object(
  JSON.parse(readFileSync(sourceLedgerPath, 'utf8')),
  'skills source ledger',
);
if (
  !Number.isInteger(sourceLedger.schemaVersion) ||
  !nonEmpty(sourceLedger.sourceLockDate, 'skills source ledger.sourceLockDate') ||
  !Array.isArray(sourceLedger.sources)
) {
  fail('skills source ledger schema is invalid');
}
for (const [index, source] of sourceLedger.sources.entries()) {
  const row = object(source, `skills source ledger source ${index}`);
  for (const key of [
    'name',
    'repository',
    'revision',
    'licence',
    'licenceStatus',
    'decision',
    'status',
  ]) {
    nonEmpty(row[key], `skills source ledger source ${index}.${key}`);
  }
  list(row.paths, `skills source ledger source ${index}.paths`);
}

const brandPackageHashes = new Map([
  [
    'package/brand-os-input/brand-identity-design.skill',
    '58a6af2b5e403bd7bd64c30fdb0d1e8ca77eb3881078e918a233359f28ad1496',
  ],
  [
    'package/brand-os-input/brand-naming.skill',
    '15d1a1a92c644a4fc880d7a8f766d7b27c9e4d685842b21d6dff10fb9f471e64',
  ],
  [
    'package/brand-os-input/brand-os.skill',
    '6779dce51f2c18ba5a51dff54f5a657704f2d43b8fd965644a538f48ee20ae9a',
  ],
  [
    'package/brand-os-input/brand-red-team.skill',
    'cfed4b3dada52056ce5e948c37ab56fda9f7994a52c7f0fbc9d910146e4593b8',
  ],
  [
    'package/brand-os-input/brand-strategy.skill',
    'd402033ce90a34a1536537278d35e24d50d4f5d8bfbcae525cbbdaabc838f564',
  ],
  [
    'package/brand-os-input/brand-verbal-identity.skill',
    '736c422ccccde46e5a953b8ca827585083839797a6b8e986ca5f25969fe75454',
  ],
  [
    'package/brand-os-input/personal-brand-authority.skill',
    '48f3666fb3f42feab0dbc45c882db4afd1596cfa64b0c85b82c78ef89cca4fbb',
  ],
]);
const brandPackageSource = sourceLedger.sources.find(
  (source) => source.name === 'owner-supplied-brand-os-skill-packages',
);
if (!brandPackageSource) fail('owner-supplied Brand OS package provenance is missing');
const brandPackagePaths = list(brandPackageSource.paths, 'Brand OS package provenance paths');
if (
  brandPackagePaths.slice().sort().join('\n') !== [...brandPackageHashes.keys()].sort().join('\n')
) {
  fail('Brand OS provenance must name exactly the seven supplied packages');
}
for (const [locator, expected] of brandPackageHashes) {
  const path = resolve(root, locator);
  if (!inside(path) || !existsSync(path)) fail(`Brand OS package is unavailable: ${locator}`);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) fail(`Brand OS package hash mismatch: ${locator}`);
}

const stagedIds = new Set(
  registry.entries
    .filter((entry) => object(entry, 'skill registry entry').provenance?.stagingCandidateDigest)
    .map((entry) => nonEmpty(entry.id, 'staged skill registry entry id')),
);
if (stagedIds.size !== 43) fail(`expected 43 staged skill entries, found ${stagedIds.size}`);
for (const entry of registry.entries.filter((item) =>
  stagedIds.has(nonEmpty(item.id, 'skill registry entry id')),
)) {
  const row = object(entry, 'staged skill registry entry');
  list(row.aliases, `staged skill ${row.id}.aliases`);
  const authority = object(row.authority, `staged skill ${row.id}.authority`);
  nonEmpty(authority.execution, `staged skill ${row.id}.authority.execution`);
  nonEmpty(authority.mutation, `staged skill ${row.id}.authority.mutation`);
  const provenance = object(row.provenance, `staged skill ${row.id}.provenance`);
  if (
    nonEmpty(provenance.sourceLedger, `staged skill ${row.id}.provenance.sourceLedger`) !==
    'package/source-ledger.json'
  ) {
    fail(`staged skill ${row.id}.provenance.sourceLedger must name the canonical source ledger`);
  }
}

const assets = object(
  JSON.parse(readFileSync(assetRegistryPath, 'utf8')),
  'reusable asset registry',
);
if (!Number.isInteger(assets.version) || !Array.isArray(assets.assets))
  fail('reusable asset registry schema is invalid');
const assetRows = assets.assets.map((asset, index) => validateAsset(asset, `asset ${index}`));
const ids = assetRows.map((asset) => asset.id);
if (new Set(ids).size !== ids.length) fail('reusable asset registry has duplicate ids');
for (const asset of assetRows) {
  const provenance = object(asset.provenance, `asset ${asset.id}.provenance`);
  for (const key of ['sourceProject', 'sourceVersion', 'owner', 'license']) {
    nonEmpty(provenance[key], `asset ${asset.id}.provenance.${key}`);
  }
  list(provenance.lineage, `asset ${asset.id}.provenance.lineage`);
  list(asset.compatibility, `asset ${asset.id}.compatibility`);
  if (!Array.isArray(asset.dependencies)) fail(`asset ${asset.id}.dependencies must be an array`);
  const evidence = object(asset.evidence, `asset ${asset.id}.evidence`);
  list(evidence.tests, `asset ${asset.id}.evidence.tests`);
  nonEmpty(evidence.latestVerifiedVersion, `asset ${asset.id}.evidence.latestVerifiedVersion`);
  list(asset.limitations, `asset ${asset.id}.limitations`);
  const usage = object(asset.usage, `asset ${asset.id}.usage`);
  if (!Number.isInteger(usage.successfulProjects) || usage.successfulProjects < 0)
    fail(`asset ${asset.id}.usage.successfulProjects is invalid`);
  if (!Number.isInteger(usage.incidents) || usage.incidents < 0)
    fail(`asset ${asset.id}.usage.incidents is invalid`);
  nonEmpty(usage.latestVerifiedVersion, `asset ${asset.id}.usage.latestVerifiedVersion`);
  nonEmpty(asset.wrapperPolicy, `asset ${asset.id}.wrapperPolicy`);
}

const gbrain = object(JSON.parse(readFileSync(gbrainIndexPath, 'utf8')), 'GBrain asset index');
if (
  gbrain.kind !== 'gbrain-reusable-asset-metadata' ||
  !Array.isArray(gbrain.assets) ||
  gbrain.contentPolicy !== 'metadata-only; implementation bodies remain at the canonical locator'
) {
  fail('GBrain asset index must be metadata-only');
}
for (const row of gbrain.assets) {
  const asset = object(row, 'GBrain asset metadata');
  if (!ids.includes(nonEmpty(asset.id, 'GBrain asset metadata.id')))
    fail('GBrain index references unknown asset');
  if ('content' in asset || 'body' in asset || 'source' in asset)
    fail('GBrain asset index must not duplicate implementation content');
}

const candidates = object(JSON.parse(readFileSync(candidatePath, 'utf8')), 'asset candidates');
if (!Number.isInteger(candidates.version) || !Array.isArray(candidates.assets))
  fail('asset candidates schema is invalid');
for (const [index, row] of candidates.assets.entries())
  validateAsset(row, `asset candidate ${index}`);

const fixtureIds = new Set();
for (const fixture of readdirSync(evalRoot).filter((name) => name.endsWith('.json'))) {
  const value = object(
    JSON.parse(readFileSync(join(evalRoot, fixture), 'utf8')),
    `resolver fixture ${fixture}`,
  );
  const skill = nonEmpty(value.skill, `resolver fixture ${fixture}.skill`);
  if (!registered.includes(skill))
    fail(`resolver fixture ${fixture} references an unknown internal skill`);
  if (fixtureIds.has(skill)) fail(`multiple resolver fixtures for ${skill}`);
  fixtureIds.add(skill);
  const positive = list(value.should_trigger, `resolver fixture ${fixture}.should_trigger`);
  const negative = list(value.should_not_trigger, `resolver fixture ${fixture}.should_not_trigger`);
  if (positive.length === 0 || negative.length === 0)
    fail(`resolver fixture ${fixture} requires positive and negative cases`);
}
for (const id of registered) {
  if (!fixtureIds.has(id)) fail(`internal skill ${id} has no resolver fixture`);
}

const reconciliation = object(
  JSON.parse(readFileSync(reconciliationLedgerPath, 'utf8')),
  'skills reconciliation ledger',
);
if (!Array.isArray(reconciliation.entries)) fail('skills reconciliation ledger schema is invalid');
const reconciled = new Set();
for (const entry of reconciliation.entries) {
  const row = object(entry, 'skills reconciliation ledger entry');
  const id = nonEmpty(row.id, 'skills reconciliation ledger entry.id');
  if (reconciled.has(id)) fail(`skills reconciliation ledger duplicate entry ${id}`);
  reconciled.add(id);
  nonEmpty(row.disposition, `skills reconciliation ledger entry ${id}.disposition`);
  if (row.disposition === 'ADD') {
    if (!registered.includes(id)) fail(`added reconciliation row ${id} is not registered`);
    if (!installed.includes(id)) fail(`added reconciliation row ${id} has no skill directory`);
    if (!fixtureIds.has(id)) fail(`added reconciliation row ${id} has no resolver fixture`);
    for (const field of ['source', 'status', 'provenance', 'sourceHashDisposition'])
      nonEmpty(row[field], `added reconciliation row ${id}.${field}`);
  }
}
for (const id of stagedIds) {
  if (!reconciled.has(id)) fail(`staged skill ${id} has no reconciliation disposition`);
}

const capabilityMatrix = object(
  JSON.parse(readFileSync(capabilityMatrixPath, 'utf8')),
  'worker capability matrix',
);
if (!Number.isInteger(capabilityMatrix.schemaVersion) || !Array.isArray(capabilityMatrix.roles)) {
  fail('worker capability matrix schema is invalid');
}
const roleIds = new Set();
for (const role of capabilityMatrix.roles) {
  const row = object(role, 'worker capability matrix role');
  const id = nonEmpty(row.id, 'worker capability matrix role.id');
  if (roleIds.has(id)) fail(`worker capability matrix duplicate role ${id}`);
  roleIds.add(id);
  if (!['worker', 'manager'].includes(row.kind))
    fail(`worker capability matrix role ${id}.kind is invalid`);
  for (const field of ['requiredSkills', 'optionalSkills']) {
    const skills = list(row[field], `worker capability matrix role ${id}.${field}`);
    for (const skill of skills) {
      if (!registered.includes(skill))
        fail(`worker capability matrix role ${id} references unknown skill ${skill}`);
    }
  }
  for (const field of ['permissionProfile', 'boundary', 'qualityGate']) {
    nonEmpty(row[field], `worker capability matrix role ${id}.${field}`);
  }
  if (!Array.isArray(row.gaps)) fail(`worker capability matrix role ${id}.gaps must be an array`);
}
if (roleIds.size !== 18) fail(`expected 18 worker capability roles, found ${roleIds.size}`);

console.log(
  `Major skill validation passed: ${installed.length} internal skills, ${assetRows.length} reusable assets.`,
);
