import { basename } from 'node:path';

/** Default owner target for the share of runs Major spends on itself. */
export const DEFAULT_SELF_WORK_TARGET_PCT = 15;

/** Major self-work is budgeted: admission needs the owner's explicit flag. */
export const MAJOR_SELF_WORK_REFUSAL =
  'this goal targets Major itself; Major self-work needs the explicit owner flag ' +
  '--major-self-work. Prefer capturing the lesson (`major learn capture`) and batching ' +
  'Major changes into the weekly learning PR (`major learn digest`).';

export function selfWorkTargetPct(value?: string): number {
  for (const raw of [value, process.env.MAJOR_SELF_WORK_TARGET_PCT]) {
    const parsed = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }
  return DEFAULT_SELF_WORK_TARGET_PCT;
}

/**
 * True when the work targets Major itself: the project-baracks repository, any
 * of its worktrees or clones, or a legacy `major-*` scratch project.
 * ponytail: name heuristic; replace with a git-common-dir/remote check if a
 * real project is ever named `major-*`.
 */
export function isMajorSelfWork(target: {
  project?: string | null | undefined;
  repoPath?: string | null | undefined;
  githubRepo?: string | null | undefined;
}): boolean {
  const project = target.project ?? '';
  const repoPath = target.repoPath ?? '';
  return (
    /(^|[/:])project-baracks(\.git)?($|[/-])/.test(project) ||
    /^major-/.test(project) ||
    /(^|\/)project-baracks($|\/)/.test(repoPath) ||
    /^major-/.test(basename(repoPath)) ||
    /project-baracks/.test(target.githubRepo ?? '')
  );
}
