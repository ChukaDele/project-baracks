import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type SupportedHost = 'claude' | 'codex' | 'cursor' | 'antigravity';

export const SUPPORTED_HOSTS: readonly SupportedHost[] = [
  'claude',
  'codex',
  'cursor',
  'antigravity',
];

export interface HostIntegrationStatus {
  /** Major's global rules/instructions file is present for this host. */
  rulesInstalled: boolean;
  /** Major's automatic attach hook (SessionStart/sessionStart/PreInvocation) is wired up. */
  hookInstalled: boolean;
}

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function codexHome(): string {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
}

/**
 * Pure filesystem presence check for what install-major-runtime.sh /
 * install-major-global-rules.sh actually write via stage-major-user-state.py.
 * This never spawns a process and never checks whether the host's own CLI is
 * installed -- that is a separate, execution-level "installed" signal.
 */
export function hostIntegrationStatus(host: SupportedHost): HostIntegrationStatus {
  const home = homedir();
  switch (host) {
    case 'claude': {
      const rulesFile = existsSync(join(home, '.claude', 'major-global.md'));
      const imported = readSafe(join(home, '.claude', 'CLAUDE.md')).includes(
        '@~/.claude/major-global.md',
      );
      const hook = readSafe(join(home, '.claude', 'settings.json')).includes(
        'session hook --host claude',
      );
      return { rulesInstalled: rulesFile && imported, hookInstalled: hook };
    }
    case 'codex': {
      const rules = readSafe(join(codexHome(), 'AGENTS.md')).includes('MAJOR-GLOBAL-START');
      const hook = readSafe(join(codexHome(), 'hooks.json')).includes('session hook --host codex');
      return { rulesInstalled: rules, hookInstalled: hook };
    }
    case 'cursor': {
      const rules = existsSync(join(home, '.cursor', 'rules', 'major-global', 'RULE.mdc'));
      const hook = readSafe(join(home, '.cursor', 'hooks.json')).includes(
        'session hook --host cursor',
      );
      return { rulesInstalled: rules, hookInstalled: hook };
    }
    case 'antigravity': {
      const plugin = existsSync(join(home, '.major', 'gemini-plugin', 'hooks.json'));
      const registered = readSafe(join(home, '.gemini', 'config', 'plugins.json')).includes(
        'gemini-plugin',
      );
      return { rulesInstalled: plugin, hookInstalled: registered && plugin };
    }
  }
}
