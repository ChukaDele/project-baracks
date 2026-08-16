import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const homes: string[] = [];
const script = 'scripts/configure-major-creative-connectors.py';
const endpoint = 'https://mcp.magnific.com';

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'major-creative-connectors-'));
  homes.push(home);
  return home;
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('Magnific creative connector setup', () => {
  it('configures Cursor, Gemini CLI and Antigravity globally without deleting existing servers', () => {
    const home = tempHome();
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { existing: { url: 'https://example.test/mcp' } } }),
    );

    execFileSync(
      'python3',
      [script, '--home', home, '--skip-native-clis'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(json(join(home, '.cursor', 'mcp.json'))).toMatchObject({
      mcpServers: {
        existing: { url: 'https://example.test/mcp' },
        magnific: { url: endpoint },
      },
    });
    expect(json(join(home, '.gemini', 'settings.json'))).toMatchObject({
      mcpServers: { magnific: { httpUrl: endpoint } },
    });
    expect(json(join(home, '.gemini', 'config', 'mcp_config.json'))).toMatchObject({
      mcpServers: { magnific: { serverUrl: endpoint } },
    });
  });

  it('is idempotent for already-canonical JSON host configuration', () => {
    const home = tempHome();
    execFileSync('python3', [script, '--home', home, '--skip-native-clis'], {
      cwd: process.cwd(),
    });
    const before = readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8');
    const output = execFileSync('python3', [script, '--home', home, '--skip-native-clis'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const after = readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8');

    expect(after).toBe(before);
    expect(output).toContain('Cursor: already configured');
    expect(output).toContain('Gemini CLI: already configured');
    expect(output).toContain('Antigravity: already configured');
  });

  it('refuses to overwrite malformed existing MCP JSON', () => {
    const home = tempHome();
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), '{not-json');

    const result = spawnSync(
      'python3',
      [script, '--home', home, '--skip-native-clis'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refusing to overwrite malformed JSON config');
  });
});
