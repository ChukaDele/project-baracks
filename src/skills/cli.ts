import {
  auditSkillReachability,
  installedSkillCatalogPath,
  resolveSkills,
} from './resolver.js';
import { loadGeneratedSkillCatalog, searchSkillCatalog } from './catalog.js';
import {
  deprecateGeneratedSkill,
  listSkillCandidates,
  loadActiveGeneratedSkills,
  promoteSkillCandidate,
  restoreGeneratedSkill,
  skillLifecycleMetrics,
} from './lifecycle.js';
import { rollbackMajorSkills, syncMajorSkills } from './sync.js';
import { retrieveReusableAssets } from './assets.js';
import { resolveProject } from '../supervisor/state.js';
import { readFileSync } from 'node:fs';
import type { SkillOptimizationEvidence } from './optimizer-validation.js';
import { fetchVendorSection } from './vendor.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function flags(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]!] : [],
  );
}

export async function runSkillCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'skill') return false;
  if (args[1] === 'sync') {
    const source = flag(args, '--source');
    const result = syncMajorSkills(source ? { sourceRoot: source } : {});
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Major hot skills activated: ${result.internalSkillCount} internal skills`);
      console.log(`vendor-live skills: ${result.vendorSkillCount}`);
      console.log(`bundle: ${result.bundleId}`);
      console.log(`registry version: ${result.registryVersion}`);
      console.log(`source: ${result.sourceRoot}`);
    }
    return true;
  }
  if (args[1] === 'assets') {
    const task = flag(args, '--task');
    if (!task) throw new Error('missing required --task');
    const result = retrieveReusableAssets({ task, cwd: flag(args, '--cwd') ?? process.cwd() });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else if (result.assets.length === 0) console.log('No verified reusable asset matched this task.');
    else {
      for (const asset of result.assets) {
        console.log(`${asset.id}\t${asset.kind}\t${asset.locator}\t${asset.summary}`);
      }
    }
    return true;
  }
  if (args[1] === 'rollback') {
    const result = rollbackMajorSkills();
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`Major Skills Library rolled back to: ${result.bundleId}`);
    return true;
  }
  if (args[1] === 'resolve') {
    const task = flag(args, '--task');
    if (!task) throw new Error('missing required --task');
    const selected = flags(args, '--skill');
    const result = resolveSkills({
      task,
      cwd: flag(args, '--cwd') ?? process.cwd(),
      ...(selected.length ? { skills: selected } : {}),
    });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else if (result.skills.length === 0) console.log('No installed Major skill matched this task.');
    else {
      for (const skill of result.skills) {
        console.log(`${skill.id}\t${skill.path ?? skill.reference}\t${skill.reason}`);
      }
      console.log(`receipt\t${result.receipt.mode}\t${result.receipt.selected.join(',')}`);
    }
    return true;
  }
  if (args[1] === 'search' || args[1] === 'catalog') {
    const catalog = loadGeneratedSkillCatalog(installedSkillCatalogPath()).entries;
    const query = flag(args, '--query');
    const result = query ? searchSkillCatalog(catalog, query) : catalog;
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else for (const skill of result) console.log(`${skill.id}\t${skill.description}`);
    return true;
  }
  if (args[1] === 'vendor') {
    const task = flag(args, '--task');
    if (!task) throw new Error('missing required --task');
    const resolved = resolveSkills({ task, cwd: flag(args, '--cwd') ?? process.cwd() });
    const vendorSkills = resolved.skills.filter((skill) => skill.vendor !== undefined);
    const refreshed = [];
    if (args.includes('--refresh')) {
      for (const skill of vendorSkills) {
        if (!skill.vendor) continue;
        try {
          const fetched = await fetchVendorSection({ selection: skill.vendor });
          refreshed.push({
            id: skill.id,
            fetchedAt: fetched.fetchedAt,
            fromCache: fetched.fromCache,
            content: fetched.content,
          });
        } catch (error) {
          refreshed.push({
            id: skill.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    const result = {
      task,
      skills: vendorSkills.map((skill) => ({
        id: skill.id,
        score: skill.score,
        reason: skill.reason,
        reference: skill.reference,
        vendor: skill.vendor,
      })),
      refreshed,
    };
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else if (vendorSkills.length === 0) console.log('No live vendor skill matched this task.');
    else {
      for (const skill of vendorSkills) {
        const vendor = skill.vendor!;
        console.log(
          `${skill.id}\t${vendor.state}\t${vendor.sectionId}\t${vendor.referenceUrl}`,
        );
      }
      if (refreshed.length > 0) console.log(`refreshed: ${refreshed.length}`);
    }
    return true;
  }
  if (args[1] === 'audit') {
    const result = auditSkillReachability(flag(args, '--cwd') ?? process.cwd());
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      for (const skill of result.internal) {
        console.log(`${skill.reachable ? 'reachable' : 'missing'}\t${skill.id}\t${skill.path ?? '-'}`);
      }
      for (const skill of result.vendor) {
        console.log(
          `${skill.available ? 'available' : 'unavailable'}\t${skill.id}\t${skill.state}\t${skill.reference ?? '-'}`,
        );
      }
      if (result.duplicateIds.length) console.log(`duplicate ids: ${result.duplicateIds.join(', ')}`);
      if (result.orphanInternalSkills.length)
        console.log(`orphan internal skills: ${result.orphanInternalSkills.join(', ')}`);
    }
    if (
      args.includes('--strict') &&
      (result.internal.some((skill) => !skill.reachable) ||
        result.duplicateIds.length > 0 ||
        result.orphanInternalSkills.length > 0)
    ) {
      throw new Error('Major skill audit failed: unreachable, duplicate or orphan skills found');
    }
    return true;
  }
  if (args[1] === 'candidates') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const candidates = listSkillCandidates(resolved.project);
    if (args.includes('--json')) console.log(JSON.stringify(candidates, null, 2));
    else if (candidates.length === 0) console.log('No Major skill candidates.');
    else {
      for (const candidate of candidates) {
        console.log(
          `${candidate.status}\t${candidate.confidence}\t${candidate.occurrences}x\t${candidate.skillId}\t${candidate.targetSkillId ?? '-'}`,
        );
      }
    }
    return true;
  }
  if (args[1] === 'promote') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const id = flag(args, '--id');
    if (!id) throw new Error('missing required --id');
    const evidencePath = flag(args, '--optimization-evidence');
    if (!evidencePath) throw new Error('missing required --optimization-evidence');
    const optimizationEvidence = JSON.parse(
      readFileSync(evidencePath, 'utf8'),
    ) as unknown as SkillOptimizationEvidence;
    console.log(
      JSON.stringify(
        promoteSkillCandidate({
          id,
          project: resolved.project,
          repoPath: resolved.repoPath,
          optimizationEvidence,
        }),
        null,
        2,
      ),
    );
    return true;
  }
  if (args[1] === 'deprecate') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const id = flag(args, '--id');
    if (!id) throw new Error('missing required --id');
    console.log(JSON.stringify(deprecateGeneratedSkill(resolved.project, id), null, 2));
    return true;
  }
  if (args[1] === 'metrics') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    console.log(
      JSON.stringify(
        {
          summary: skillLifecycleMetrics(resolved.project),
          active: loadActiveGeneratedSkills(resolved.repoPath),
        },
        null,
        2,
      ),
    );
    return true;
  }
  if (args[1] === 'restore') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const id = flag(args, '--id');
    if (!id) throw new Error('missing required --id');
    console.log(JSON.stringify(restoreGeneratedSkill(resolved.project, id), null, 2));
    return true;
  }
  return false;
}
