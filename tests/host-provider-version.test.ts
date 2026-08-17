import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostProviderVersion } from '../src/providers/host-provider-version.js';

function fakeExecutable(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'major-host-version-'));
  const path = join(dir, 'fake-provider');
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('hostProviderVersion', () => {
  it('extracts a semver-shaped version from --version output', () => {
    const path = fakeExecutable('echo "codex-cli 0.145.0"');
    expect(hostProviderVersion(path)).toBe('0.145.0');
  });

  it('extracts a version even when the output has surrounding text', () => {
    const path = fakeExecutable('echo "Codex CLI\\nversion: 1.2.3 (build abc)"');
    expect(hostProviderVersion(path)).toBe('1.2.3');
  });

  it('returns undefined when --version exits non-zero with no usable output', () => {
    const path = fakeExecutable('echo "unknown flag" >&2; exit 1');
    expect(hostProviderVersion(path)).toBeUndefined();
  });

  it('returns undefined when the binary does not exist', () => {
    expect(hostProviderVersion('/no/such/binary/here')).toBeUndefined();
  });

  it('refuses a non-absolute path rather than resolving it via PATH', () => {
    expect(hostProviderVersion('codex')).toBeUndefined();
  });
});
