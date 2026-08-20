import { auditSkillReachability, resolveSkills } from './resolver.js';
import {
  deprecateGeneratedSkill,
  listSkillCandidates,
  loadActiveGeneratedSkills,
  promoteSkillCandidate,
  restoreGeneratedSkill,
  skillLifecycleMetrics,
} from './lifecycle.js';
import { syncMajorSkills } from './sync.js';
import { resolveProject } from '../supervisor/state.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runSkillCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'skill') return false;
  if (args[1] === 'sync') {
    const source = flag(args, '--source');
    const result = syncMajorSkills(source ? { sourceRoot: source } : {});
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Major hot skills activated: ${result.internalSkillCount} internal skills`);
      console.log(`bundle: ${result.bundleId}`);
      console.log(`registry version: ${result.registryVersion}`);
      console.log(`source: ${result.sourceRoot}`);
    }
    return true;
  }
  if (args[1] === 'resolve') {
    const task = flag(args, '--task');
    if (!task) throw new Error('missing required --task');
    const result = resolveSkills({ task, cwd: flag(args, '--cwd') ?? process.cwd() });
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else if (result.skills.length === 0) console.log('No installed Major skill matched this task.');
    else {
      for (const skill of result.skills) {
        console.log(`${skill.id}\t${skill.path}\t${skill.reason}`);
      }
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
    console.log(
      JSON.stringify(
        promoteSkillCandidate({ id, project: resolved.project, repoPath: resolved.repoPath }),
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
