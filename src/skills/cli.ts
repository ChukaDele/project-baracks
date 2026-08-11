import { auditSkillReachability, resolveSkills } from './resolver.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runSkillCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'skill') return false;
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
    return true;
  }
  return false;
}
