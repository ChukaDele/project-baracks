import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerReadOnlyRoots } from '../src/security/provider-access.js';

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'major-provider-home-'));
  for (const relative of [
    '.claude/settings.json',
    '.claude/projects/private.json',
    '.codex/auth.json',
    '.codex/attachments/private.txt',
    '.gemini/antigravity-cli/settings.json',
  ]) {
    const path = join(home, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'fixture');
  }
  return home;
}

describe('provider authentication read roots', () => {
  it('exposes only the selected provider minimum and excludes histories and project data', () => {
    const home = fixtureHome();
    const roots = providerReadOnlyRoots('/trusted/bin/claude', home);

    expect(roots).toEqual([join(home, '.claude/settings.json')]);
    expect(roots.join('\n')).not.toMatch(/projects|attachments|\.codex|\.gemini/);
  });

  it('returns no config roots for an unknown executable', () => {
    expect(providerReadOnlyRoots('/trusted/bin/not-a-provider', fixtureHome())).toEqual([]);
  });
});
