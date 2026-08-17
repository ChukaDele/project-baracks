import { describe, expect, it } from 'vitest';
import { guestProviderProfile } from '../src/execution/provider-profile.js';

describe('Lima provider profiles', () => {
  it.each([
    [
      'claude',
      'major-claude',
      '/opt/major/providers/v1/claude/bin/claude',
      '.claude/.credentials.json',
    ],
    ['codex', 'major-codex', '/opt/major/providers/v1/codex/bin/codex-native', '.codex/auth.json'],
    [
      'cursor-agent',
      'major-cursor',
      '/opt/major/providers/v1/cursor/bin/cursor-agent',
      '.config/cursor/auth.json',
    ],
    [
      'agy',
      'major-antigravity',
      '/opt/major/providers/v1/antigravity/bin/agy',
      '.gemini/antigravity-cli/antigravity-oauth-token',
    ],
  ] as const)('maps %s to one fixed guest identity', (name, user, executable, authRelativePath) => {
    const profile = guestProviderProfile(name);
    expect(profile.user).toBe(user);
    expect(profile.home).toBe(`/home/${user}`);
    expect(profile.executable).toBe(executable);
    expect(profile.authRelativePath).toBe(authRelativePath);
    expect(profile.probeArgs.length).toBeGreaterThan(0);
  });

  it('rejects path aliases and unknown providers', () => {
    expect(() => guestProviderProfile('/tmp/codex')).toThrow(/path-qualified/);
    expect(() => guestProviderProfile('node')).toThrow(/unsupported/);
  });

  it('only codex has a verified native-login flow for now', () => {
    expect(guestProviderProfile('codex').loginArgs).toEqual(['login', '--device-auth']);
    expect(guestProviderProfile('claude').loginArgs).toBeUndefined();
    expect(guestProviderProfile('cursor-agent').loginArgs).toBeUndefined();
    expect(guestProviderProfile('agy').loginArgs).toBeUndefined();
  });
});
