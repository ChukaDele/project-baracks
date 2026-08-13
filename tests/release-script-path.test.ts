import {
  chmodSync,
  copyFileSync,
  existsSync,
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
    expect(readFileSync('tests/cli.test.ts', 'utf8')).toContain(
      "execFileSync('corepack', ['pnpm', 'build']",
    );
  });

  it('rejects the account home before deletion when HOME is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-snapshot-home-'));
    const bin = join(root, 'bin');
    const simulatedHome = join(root, 'account-home');
    mkdirSync(bin);
    mkdirSync(simulatedHome);
    writeFileSync(join(simulatedHome, 'sentinel'), 'preserve\n');
    writeFileSync(
      join(bin, 'python3'),
      `#!/bin/sh\nif [ "$#" -eq 2 ]; then printf '%s\\n' "$2"; else printf '%s\\n' "${simulatedHome}"; fi\n`,
    );
    chmodSync(join(bin, 'python3'), 0o755);

    const result = spawnSync(
      '/bin/bash',
      ['scripts/build-major-runtime-snapshot.sh', simulatedHome],
      {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin` },
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('refusing unsafe runtime snapshot destination');
    expect(existsSync(join(simulatedHome, 'sentinel'))).toBe(true);
  });
});
