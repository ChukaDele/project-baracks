import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { hashSourceWorkspaceTree } from '../execution/workspace-transfer.js';

export interface SupervisorSourceIdentity {
  sourceHead: string;
  sourceTreeDigest: string;
  frozenAt: string;
}

export function gitCommonDir(repoPath: string): string | undefined {
  const marker = join(repoPath, '.git');
  if (!existsSync(marker)) return undefined;
  try {
    if (statSync(marker).isDirectory()) return marker;
    const match = /^gitdir:\s*(.+)$/i.exec(readFileSync(marker, 'utf8').trim());
    const rawGitDir = match?.[1]?.trim();
    if (!rawGitDir) return undefined;
    const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(repoPath, rawGitDir);
    const commonDirFile = join(gitDir, 'commondir');
    if (!existsSync(commonDirFile)) return gitDir;
    const common = readFileSync(commonDirFile, 'utf8').trim();
    if (!common) return gitDir;
    return isAbsolute(common) ? common : resolve(gitDir, common);
  } catch {
    return undefined;
  }
}

export function exactRepositoryHead(repoPath: string): string | undefined {
  try {
    const marker = join(repoPath, '.git');
    const gitDir = statSync(marker).isDirectory()
      ? marker
      : resolve(repoPath, /^gitdir:\s*(.+)$/i.exec(readFileSync(marker, 'utf8').trim())?.[1] ?? '');
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return undefined;
    const commonDir = gitCommonDir(repoPath);
    const looseRef = [join(gitDir, ref), ...(commonDir ? [join(commonDir, ref)] : [])].find(
      existsSync,
    );
    if (looseRef) {
      const sha = readFileSync(looseRef, 'utf8').trim();
      if (/^[a-f0-9]{40}$/.test(sha)) return sha;
    }
    const packed = commonDir ? join(commonDir, 'packed-refs') : undefined;
    return packed && existsSync(packed)
      ? new RegExp(`^([a-f0-9]{40}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(
          readFileSync(packed, 'utf8'),
        )?.[1]
      : undefined;
  } catch {
    return undefined;
  }
}

export function readSupervisorSourceIdentity(
  repoPath: string,
): SupervisorSourceIdentity | undefined {
  const sourceHead = exactRepositoryHead(repoPath);
  if (!sourceHead) return undefined;
  try {
    return {
      sourceHead,
      sourceTreeDigest: hashSourceWorkspaceTree(repoPath),
      frozenAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function sourceIdentityMatches(
  expected: Pick<SupervisorSourceIdentity, 'sourceHead' | 'sourceTreeDigest'>,
  actual: Pick<SupervisorSourceIdentity, 'sourceHead' | 'sourceTreeDigest'> | undefined,
): boolean {
  return (
    actual?.sourceHead === expected.sourceHead &&
    actual.sourceTreeDigest === expected.sourceTreeDigest
  );
}
