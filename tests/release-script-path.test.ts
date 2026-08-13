import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('clean-install release gate PATH', () => {
  it('runs every package-manager step through Corepack without a pnpm executable', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-release-path-'));
    const scripts = join(root, 'scripts');
    const bin = join(root, 'bin');
    const log = join(root, 'corepack.log');
    mkdirSync(scripts);
    mkdirSync(bin);
    copyFileSync('scripts/validate-major-release.sh', join(scripts, 'validate-major-release.sh'));
    for (const name of [
      'validate-major.sh',
      'validate-major-stability.sh',
      'validate-provider-cli-contracts.sh',
      'build-major-runtime-snapshot.sh',
    ]) {
      writeFileSync(join(scripts, name), '#!/bin/sh\nexit 0\n');
      chmodSync(join(scripts, name), 0o755);
    }
    writeFileSync(join(scripts, 'validate-major-install-transaction.py'), 'raise SystemExit(0)\n');
    writeFileSync(join(bin, 'corepack'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`);
    chmodSync(join(bin, 'corepack'), 0o755);

    const result = spawnSync('/bin/bash', [join(scripts, 'validate-major-release.sh')], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: root },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm build',
    ]);
  });
});
