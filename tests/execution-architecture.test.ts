import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

describe('single execution boundary', () => {
  it('keeps process spawning and the fixed memory probe in their only approved modules', () => {
    const root = resolve(import.meta.dirname, '..');
    const offenders = sourceFiles(join(root, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('node:child_process')) return [];
      return [relative(root, path)];
    });
    expect(offenders.sort()).toEqual([
      // Execs an existing, already-audited lifecycle script (rollback) that
      // must run outside the currently-loaded process. No logic here beyond
      // that one exec — see the module doc comment.
      'src/cli/lifecycle-ops.ts',
      'src/execution/cursor-acp-runtime.ts',
      'src/execution/lima-backend.ts',
      'src/providers/exec.ts',
      // Checks only for the EXISTENCE of a macOS Keychain entry (no `-w`,
      // never reads the stored secret) as part of host credential detection
      // for `major provider connect`. Narrow, single-purpose, audited here.
      'src/providers/host-credential.ts',
      // Runs an already-resolved, trusted host provider binary with
      // `--version` only, for the host/guest compatibility diagnostic in
      // `major provider connect`. No other args, no shell, short timeout.
      'src/providers/host-provider-version.ts',
      'src/security/major-gateway.ts',
      'src/security/secure-enclave-attestation.ts',
      'src/security/system-memory.ts',
    ]);
  });

  it('allows only the canonical gateway to import the spawn engine', () => {
    const root = resolve(import.meta.dirname, '..');
    const importers = sourceFiles(join(root, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const staticImport = /from\s+['"][^'"]*providers\/exec\.js['"]/.test(source);
      const dynamicImport = /import\s*\(\s*['"][^'"]*providers\/exec\.js['"]\s*\)/.test(source);
      if (!staticImport && !dynamicImport) return [];
      return [relative(root, path)];
    });
    expect(importers).toEqual(['src/security/gateway.ts']);
  });

  it('does not expose internal runtime modules as package entry points', () => {
    const root = resolve(import.meta.dirname, '..');
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8') as string) as {
      bin?: Record<string, string>;
      exports?: unknown;
    };
    expect(packageJson.bin).toEqual({ major: './dist/entry.js' });
    expect(packageJson.exports).toBeUndefined();
  });

  it('does not convert PATH discovery into trust or expose the immutable runtime as writable', () => {
    const root = resolve(import.meta.dirname, '..');
    const gateway = readFileSync(join(root, 'src', 'security', 'major-gateway.ts'), 'utf8');
    const worker = readFileSync(join(root, 'src', 'supervisor', 'worker.ts'), 'utf8');
    expect(gateway).not.toContain('resolveForReport');
    expect(worker).not.toContain('majorRepoRoot');
    expect(worker).not.toContain("input.host === 'antigravity'");
  });
});
