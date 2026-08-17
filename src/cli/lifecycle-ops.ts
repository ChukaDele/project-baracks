import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Thin, narrow entry points for lifecycle scripts that must run OUTSIDE the
 * currently-loaded process (they replace the very files the running `major`
 * binary was loaded from). Each one just execs an existing, already-audited
 * maintainer script — no new logic lives here. Kept in its own file, like
 * providers/host-credential.ts, so the CLI's own spawn surface stays this
 * one narrow module instead of the whole cli/index.ts file.
 */
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function runRollbackScript(): void {
  execFileSync('bash', [join(REPO_ROOT, 'scripts', 'rollback-major-runtime.sh')], {
    stdio: 'inherit',
  });
}
