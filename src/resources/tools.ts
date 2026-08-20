import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';

export interface LimaInstanceRow {
  name: string;
}

export interface ReclaimTools {
  listLimaInstances: () => LimaInstanceRow[];
  deleteLimaInstance: (name: string) => void;
  pruneLima: () => void;
  pruneGitWorktrees: (cwd?: string) => void;
  prunePnpmStore: () => void;
}

function run(
  executable: string,
  args: readonly string[],
  cwd?: string,
): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(executable, [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      ...(cwd ? { cwd } : {}),
    });
    return { stdout, status: 0 };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { stdout: `${err.stdout ?? ''}${err.stderr ?? ''}`, status: err.status ?? 1 };
  }
}

export function parseLimaList(stdout: string): LimaInstanceRow[] {
  const rows: LimaInstanceRow[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { name?: string };
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        rows.push({ name: parsed.name });
      }
    } catch {
      // skip non-JSON noise
    }
  }
  return rows;
}

export function createReclaimTools(
  input: {
    limactlPath?: string;
    gitPath?: string;
    pnpmPath?: string;
  } = {},
): ReclaimTools {
  const limactl = input.limactlPath ?? 'limactl';
  const git = input.gitPath ?? 'git';
  const pnpm = input.pnpmPath ?? 'pnpm';
  return {
    listLimaInstances: () => {
      if (limactl !== 'limactl' && !existsSync(limactl)) return [];
      const result = run(limactl, ['list', '--json']);
      if (result.status !== 0) throw new Error(result.stdout.trim() || 'limactl list failed');
      return parseLimaList(result.stdout);
    },
    deleteLimaInstance: (name) => {
      const result = run(limactl, ['delete', '--force', name]);
      if (result.status !== 0) {
        throw new Error(result.stdout.trim() || `limactl delete ${name} failed`);
      }
    },
    pruneLima: () => {
      run(limactl, ['prune']);
    },
    pruneGitWorktrees: (cwd = homedir()) => {
      const gitDir = existsSync(`${cwd}/.git`) ? cwd : dirname(cwd);
      run(git, ['worktree', 'prune'], gitDir);
    },
    prunePnpmStore: () => {
      run(pnpm, ['store', 'prune']);
    },
  };
}

/** Deterministic maintenance clone used by hot skill sync. */
export function cloneGitBranch(input: {
  repoUrl: string;
  branch: string;
  destination: string;
  gitPath?: string;
}): void {
  const result = run(input.gitPath ?? 'git', [
    'clone',
    '--quiet',
    '--depth',
    '1',
    '--branch',
    input.branch,
    input.repoUrl,
    input.destination,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stdout.trim() || `git clone ${input.repoUrl} failed`);
  }
}

/** tar.gz a directory next to itself. Used only for cold-archive compaction. */
export function tarGzDirectory(path: string): string {
  const archive = `${path}.tar.gz`;
  const result = run('tar', ['-czf', archive, '-C', dirname(path), basename(path)]);
  if (result.status !== 0) throw new Error(result.stdout.trim() || `tar archive failed: ${path}`);
  return archive;
}
