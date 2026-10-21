import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerReadOnlyRoots } from '../src/security/provider-access.js';

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'major-provider-home-'));
  for (const relative of [
    '.claude/.credentials.json',
    '.claude/.claude.json',
    '.claude/settings.json',
    '.claude/projects/private.json',
    '.codex/auth.json',
    '.codex/attachments/private.txt',
    '.codex/rules/global.md',
    '.gemini/antigravity-cli/settings.json',
  ]) {
    const path = join(home, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'fixture');
  }
  mkdirSync(join(home, '.codex/plugins/.plugin-appserver'), { recursive: true });
  return home;
}

describe('provider authentication read roots', () => {
  it('exposes only the selected provider minimum and excludes histories and project data', () => {
    const home = fixtureHome();
    const roots = providerReadOnlyRoots('/trusted/bin/claude', home);

    expect(roots).toEqual([
      join(home, '.claude/.credentials.json'),
      join(home, '.claude/.claude.json'),
      join(home, '.claude/settings.json'),
    ]);
    expect(roots.join('\n')).not.toMatch(/projects|attachments|\.codex|\.gemini/);
  });

  it('exposes the on-demand global rule files to every provider, but nothing else in ~/.major', () => {
    const home = fixtureHome();
    for (const relative of [
      '.major/global-worker-detail.md',
      '.major/stability-invariants.md',
      '.major/major.db',
      '.major/learning-candidates.json',
    ]) {
      mkdirSync(join(home, '.major'), { recursive: true });
      writeFileSync(join(home, relative), 'fixture');
    }
    for (const provider of ['claude', 'codex', 'cursor-agent', 'agy']) {
      const roots = providerReadOnlyRoots(`/trusted/bin/${provider}`, home);
      expect(roots).toContain(join(home, '.major/global-worker-detail.md'));
      expect(roots).toContain(join(home, '.major/stability-invariants.md'));
      expect(roots.filter((root) => root.includes('/.major'))).toHaveLength(2);
    }
  });

  it('returns no config roots for an unknown executable', () => {
    expect(providerReadOnlyRoots('/trusted/bin/not-a-provider', fixtureHome())).toEqual([]);
  });

  it('allows Codex rules and session continuity without exposing attachments', () => {
    const home = fixtureHome();
    const roots = providerReadOnlyRoots('/trusted/bin/codex', home);

    expect(roots).toContain(join(home, '.codex/auth.json'));
    expect(roots).toContain(join(home, '.codex/plugins/.plugin-appserver'));
    expect(roots).toContain(join(home, '.codex/rules'));
    expect(roots).not.toContain(join(home, '.codex/attachments'));
  });
});
