import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('installed production trust boundaries', () => {
  it('ignores hostile test, authority, metadata, and host-root environment variables', () => {
    const hostileHome = mkdtempSync(join(tmpdir(), 'major-hostile-home-'));
    const hostileMajor = mkdtempSync(join(tmpdir(), 'major-hostile-authority-'));
    const hostileCodex = mkdtempSync(join(tmpdir(), 'major-hostile-codex-'));
    roots.push(hostileHome, hostileMajor, hostileCodex);
    for (const root of roots) writeFileSync(join(root, 'sentinel'), 'preserve\n');

    const probe = `
      import { trustedAccountHome, trustedCodexHome, trustedMajorHome, testFixturePath } from './dist/security/trust-roots.js';
      console.log(JSON.stringify({
        account: trustedAccountHome(),
        major: trustedMajorHome(),
        codex: trustedCodexHome(),
        registry: testFixturePath('MAJOR_SKILLS_REGISTRY'),
        evals: testFixturePath('MAJOR_SKILLS_EVALS'),
        vendor: testFixturePath('MAJOR_VENDOR_SOURCES')
      }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOME: hostileHome,
        MAJOR_HOME: hostileMajor,
        CODEX_HOME: hostileCodex,
        MAJOR_SKILLS_REGISTRY: join(hostileHome, 'registry.json'),
        MAJOR_SKILLS_EVALS: join(hostileHome, 'evals'),
        MAJOR_VENDOR_SOURCES: join(hostileHome, 'vendor.json'),
      },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      account: userInfo().homedir,
      major: join(userInfo().homedir, '.major'),
      codex: join(userInfo().homedir, '.codex'),
    });
    for (const root of roots) {
      expect(readFileSync(join(root, 'sentinel'), 'utf8')).toBe('preserve\n');
      expect(readdirSync(root)).toEqual(['sentinel']);
    }
  });

  it('ships no ambient source or remote override in the sync implementation', () => {
    const sync = readFileSync(resolve('dist/skills/sync.js'), 'utf8');
    expect(sync).not.toContain('MAJOR_SKILLS_SOURCE');
    expect(sync).not.toContain('MAJOR_SKILLS_REPO_URL');
    expect(sync).toContain('https://github.com/ChukaDele/project-baracks.git');
  });
});
