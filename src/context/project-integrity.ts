import { resolve } from 'node:path';
import { resolveProject, resolveProjectForCwd } from '../supervisor/state.js';

export interface ProjectContextResult {
  status: 'pass' | 'reroute';
  targetProject: string;
  targetRepoPath: string;
  currentProject?: string | undefined;
  currentRepoPath?: string | undefined;
}

export function checkProjectContext(
  targetProject: string,
  cwd = process.cwd(),
): ProjectContextResult {
  const current = resolveProjectForCwd(cwd);
  const target = resolveProject(targetProject, cwd);
  const currentPath = current ? resolve(current.repoPath) : undefined;
  const targetPath = resolve(target.repoPath);
  const sameRepo = currentPath !== undefined && currentPath === targetPath;

  return {
    status: sameRepo ? 'pass' : 'reroute',
    targetProject: target.project,
    targetRepoPath: targetPath,
    ...(current ? { currentProject: current.project, currentRepoPath: currentPath } : {}),
  };
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runProjectContextCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'project') return false;

  if (args[1] === 'locate') {
    const projectName = args[2];
    if (!projectName) throw new Error('usage: major project locate <project>');
    const target = resolveProject(projectName, flag(args, '--cwd') ?? process.cwd());
    if (args.includes('--json')) console.log(JSON.stringify(target, null, 2));
    else console.log(target.repoPath);
    return true;
  }

  if (args[1] === 'guard') {
    const projectName = args[2];
    if (!projectName) throw new Error('usage: major project guard <project> [--cwd <path>]');
    const result = checkProjectContext(projectName, flag(args, '--cwd') ?? process.cwd());
    if (args.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.status === 'pass') {
      console.log(
        `PROJECT CONTEXT: PASS\nproject: ${result.targetProject}\nrepo: ${result.targetRepoPath}`,
      );
    } else {
      console.log(
        `PROJECT CONTEXT: REROUTE\ncurrent: ${result.currentProject ?? 'no-git-project'} ${result.currentRepoPath ?? ''}\ntarget: ${result.targetProject} ${result.targetRepoPath}\nDo not edit the current repo. Continue the task from the target repo.`,
      );
    }
    return true;
  }

  return false;
}
