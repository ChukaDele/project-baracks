import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostIntegrationStatus } from '../src/context/host-integration.js';

let home = '';
let priorHome: string | undefined;
let priorCodexHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'major-host-integration-'));
  priorHome = process.env.HOME;
  priorCodexHome = process.env.CODEX_HOME;
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = priorCodexHome;
  rmSync(home, { recursive: true, force: true });
});

// homedir() reads os.homedir(), which on POSIX follows $HOME -- point it at
// the fixture directory instead of the real developer machine's dotfiles.
function useFixtureHome(): void {
  process.env.HOME = home;
}

describe('host integration status: pure filesystem presence, no process spawn', () => {
  it('reports nothing installed for a completely untouched home', () => {
    useFixtureHome();
    expect(homedir()).toBe(home);
    expect(hostIntegrationStatus('claude')).toEqual({
      rulesInstalled: false,
      hookInstalled: false,
    });
    expect(hostIntegrationStatus('codex')).toEqual({ rulesInstalled: false, hookInstalled: false });
    expect(hostIntegrationStatus('cursor')).toEqual({
      rulesInstalled: false,
      hookInstalled: false,
    });
    expect(hostIntegrationStatus('antigravity')).toEqual({
      rulesInstalled: false,
      hookInstalled: false,
    });
  });

  it('detects Claude rules only once both the global file and the CLAUDE.md import exist', () => {
    useFixtureHome();
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'major-global.md'), 'rules\n');
    expect(hostIntegrationStatus('claude').rulesInstalled).toBe(false);
    writeFileSync(
      join(home, '.claude', 'CLAUDE.md'),
      '# Major global worker rules\n@~/.claude/major-global.md\n',
    );
    expect(hostIntegrationStatus('claude').rulesInstalled).toBe(true);
    expect(hostIntegrationStatus('claude').hookInstalled).toBe(false);
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ command: '"major" session hook --host claude' }] }] },
      }),
    );
    expect(hostIntegrationStatus('claude').hookInstalled).toBe(true);
  });

  it('detects Codex rules via the managed block marker and the hook via hooks.json', () => {
    useFixtureHome();
    const codexHome = join(home, '.codex-custom');
    process.env.CODEX_HOME = codexHome;
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'AGENTS.md'),
      '<!-- MAJOR-GLOBAL-START -->\nrules\n<!-- MAJOR-GLOBAL-END -->\n',
    );
    expect(hostIntegrationStatus('codex').rulesInstalled).toBe(true);
    expect(hostIntegrationStatus('codex').hookInstalled).toBe(false);
    writeFileSync(
      join(codexHome, 'hooks.json'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ command: '"major" session hook --host codex' }] }] },
      }),
    );
    expect(hostIntegrationStatus('codex').hookInstalled).toBe(true);
  });

  it('detects Cursor rules via RULE.mdc presence and the hook via hooks.json', () => {
    useFixtureHome();
    mkdirSync(join(home, '.cursor', 'rules', 'major-global'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'rules', 'major-global', 'RULE.mdc'),
      '---\nalwaysApply: true\n---\nrules\n',
    );
    expect(hostIntegrationStatus('cursor').rulesInstalled).toBe(true);
    expect(hostIntegrationStatus('cursor').hookInstalled).toBe(false);
    writeFileSync(
      join(home, '.cursor', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ command: '"major" session hook --host cursor' }] },
      }),
    );
    expect(hostIntegrationStatus('cursor').hookInstalled).toBe(true);
  });

  it('does not mistake a legacy bare RULE.md for the required .mdc format', () => {
    useFixtureHome();
    mkdirSync(join(home, '.cursor', 'rules', 'major-global'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'rules', 'major-global', 'RULE.md'), 'rules\n');
    expect(hostIntegrationStatus('cursor').rulesInstalled).toBe(false);
  });

  it('detects Antigravity integration only once the plugin hooks file and the global registration both exist', () => {
    useFixtureHome();
    mkdirSync(join(home, '.major', 'gemini-plugin'), { recursive: true });
    expect(hostIntegrationStatus('antigravity')).toEqual({
      rulesInstalled: false,
      hookInstalled: false,
    });
    writeFileSync(join(home, '.major', 'gemini-plugin', 'hooks.json'), '{}\n');
    expect(hostIntegrationStatus('antigravity').rulesInstalled).toBe(true);
    expect(hostIntegrationStatus('antigravity').hookInstalled).toBe(false);
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(
      join(home, '.gemini', 'config', 'plugins.json'),
      JSON.stringify({ entries: [{ path: join(home, '.major', 'gemini-plugin') }] }),
    );
    expect(hostIntegrationStatus('antigravity').hookInstalled).toBe(true);
  });
});
