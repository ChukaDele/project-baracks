import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/doctor/doctor.js';
import { buildSupportBundle } from '../src/doctor/support-bundle.js';
import {
  importProviderToken,
  parseProviderToken,
  providerTokenEnv,
  providerTokenPath,
  readProviderToken,
} from '../src/providers/provider-token.js';
import { ExecutionGateway, type ExecutionPolicyDecision } from '../src/security/gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';

// Fake values only. Never a real token.
const FAKE_CLAUDE = `sk-ant-oat01-${'FAKEfake0123456789_-'.repeat(5)}`;
const FAKE_CURSOR = 'fake_cursor_key_0123456789abcdef';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'major-provider-token-')));
const previousHome = process.env.MAJOR_HOME;
process.env.MAJOR_HOME = home;
afterAll(() => {
  if (previousHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => rmSync(join(home, 'credentials'), { recursive: true, force: true }));

describe('provider token store', () => {
  it('stores an imported token 0600 and injects it only for its own provider', () => {
    const path = importProviderToken('claude', `${FAKE_CLAUDE}\n`);
    expect(path).toBe(join(home, 'credentials', 'claude-code'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'credentials')).mode & 0o777).toBe(0o700);
    expect(readFileSync(path, 'utf8')).toBe(FAKE_CLAUDE);
    expect(providerTokenEnv('claude')).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: FAKE_CLAUDE });
    expect(providerTokenEnv('cursor-agent')).toEqual({});
    expect(providerTokenEnv('codex')).toEqual({});

    importProviderToken('cursor', FAKE_CURSOR);
    expect(providerTokenEnv('cursor-agent')).toEqual({ CURSOR_API_KEY: FAKE_CURSOR });
  });

  it('extracts the Claude token from setup-token guidance text', () => {
    const output = `Your OAuth token (valid for 1 year):\n\n${FAKE_CLAUDE}\n\nStore it securely.`;
    expect(parseProviderToken('claude', output)).toBe(FAKE_CLAUDE);
    expect(() => parseProviderToken('claude', `${FAKE_CLAUDE} ${FAKE_CLAUDE}x`)).toThrow(
      /more than one/,
    );
    // A wrapped (cut) token is refused instead of stored as a fragment.
    expect(() =>
      parseProviderToken('claude', `${FAKE_CLAUDE.slice(0, 40)}\n${FAKE_CLAUDE.slice(40)}`),
    ).toThrow();
    expect(() => parseProviderToken('cursor', 'two words')).toThrow(/exactly one/);
    expect(() => parseProviderToken('cursor', 'short')).toThrow(/does not look like/);
    expect(() => importProviderToken('codex', FAKE_CURSOR)).toThrow(/no supported headless token/);
  });

  it('refuses a loosened or symlinked token file', () => {
    const path = importProviderToken('claude', FAKE_CLAUDE);
    chmodSync(path, 0o644);
    expect(readProviderToken('claude')).toBeUndefined();

    rmSync(path);
    const elsewhere = join(home, 'elsewhere');
    writeFileSync(elsewhere, FAKE_CLAUDE, { mode: 0o600 });
    symlinkSync(elsewhere, providerTokenPath('claude')!);
    expect(readProviderToken('claude')).toBeUndefined();
  });

  it('never puts a stored token in the support bundle', async () => {
    importProviderToken('claude', FAKE_CLAUDE);
    importProviderToken('cursor', FAKE_CURSOR);
    const report = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: () => '/usr/bin/tool',
    });
    const serialized = JSON.stringify(buildSupportBundle(report, { majorHome: home }));
    expect(serialized).not.toContain(FAKE_CLAUDE);
    expect(serialized).not.toContain(FAKE_CURSOR);
  });
});

describe('gateway credential injection', () => {
  it('gives the fake CLI its token, audits the name only and scrubs the value from output', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'major-token-gw-')));
    // A fake `claude auth status --json`: logged in only when the env token is
    // present, and it deliberately echoes the token to stdout and stderr.
    const fakeCli = join(root, 'fake-claude.mjs');
    writeFileSync(
      fakeCli,
      [
        'const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;',
        'console.log(JSON.stringify({ loggedIn: Boolean(token), authMethod: token ? "oauth_token" : "none", echo: token }));',
        'console.error(`debug token=${token}`);',
      ].join('\n'),
    );
    const registry = new TrustedExecutableRegistry();
    registry.pin(process.execPath);
    const decisions: ExecutionPolicyDecision[] = [];
    const gateway = new ExecutionGateway({
      allowedRoots: [root],
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: registry,
      // A token in the parent env must still be stripped; only the store injects.
      baseEnv: { PATH: process.env.PATH ?? '', CLAUDE_CODE_OAUTH_TOKEN: 'parent-env-value-0000' },
      credentialEnv: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_CLAUDE },
      recordDecision: (decision) => decisions.push(decision),
      containment: {
        enforced: true,
        filesystemIsolation: true,
        networkIsolation: true,
        mechanism: 'test-only',
        detail: 'test-only containment',
        wrap: (request) => ({ executable: request.executable, args: [...request.args] }),
      },
    });
    const handle = gateway.execute({ executable: 'node', args: [fakeCli], cwd: root });
    const events = [];
    for await (const event of handle.events) events.push(event);
    const outcome = await handle.outcome;
    rmSync(root, { recursive: true, force: true });

    const everything = JSON.stringify({ events, outcome, decisions });
    expect(everything).toContain('"loggedIn":true');
    expect(everything).toContain('oauth_token');
    expect(everything).not.toContain(FAKE_CLAUDE);
    expect(everything).not.toContain('parent-env-value-0000');
    expect(outcome.stderrTail).toContain('[REDACTED]');
    const execute = decisions.find((decision) => decision.kind === 'execute');
    expect(execute?.authorizedEnv).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(execute?.strippedEnv).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });
});
