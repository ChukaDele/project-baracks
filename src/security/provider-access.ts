import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PROVIDER_CONFIG_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  claude: [
    '.claude.json',
    // Claude Code stores its current auth state in this provider-owned file.
    // Keep the allowlist exact so histories, telemetry and project data stay
    // outside the host execution boundary.
    '.claude/.credentials.json',
    '.claude/.claude.json',
    '.claude/CLAUDE.md',
    '.claude/major-global.md',
    '.claude/policy-limits.json',
    '.claude/remote-settings.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
  ],
  codex: [
    '.codex/auth.json',
    '.codex/config.toml',
    '.codex/.codex-global-state.json',
    '.codex/installation_id',
    '.codex/models_cache.json',
    '.codex/plugins/.plugin-appserver',
    '.codex/rules',
    '.codex/sessions',
  ],
  'cursor-agent': ['.cursor/agent-cli-state.json', '.cursor/cli-config.json', '.cursor/rules'],
  agy: [
    '.gemini/GEMINI.md',
    '.gemini/config',
    '.gemini/antigravity-cli/settings.json',
    '.gemini/antigravity-cli/installation_id',
    '.gemini/antigravity-cli/jetski_state.pbtxt',
    '.gemini/antigravity-cli/builtin',
  ],
});

/** Minimum provider-owned files needed to authenticate, load policy and
 * explicitly resume a host-persisted Codex session and load the user's global
 * rules. Project caches, attachments and cross-project memory remain outside
 * the sandbox's readable roots. */
export function providerReadOnlyRoots(executable: string, home = homedir()): string[] {
  const name = executable.split('/').at(-1) ?? executable;
  return (PROVIDER_CONFIG_PATHS[name] ?? [])
    .map((relative) => resolve(join(home, relative)))
    .filter((path) => existsSync(path));
}
