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
    expect(offenders.sort()).toEqual(['src/providers/exec.ts', 'src/security/major-gateway.ts']);
  });

  it('allows only the canonical gateway to import the spawn engine', () => {
    const root = resolve(import.meta.dirname, '..');
    const importers = sourceFiles(join(root, 'src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!source.includes("from '../providers/exec.js'")) return [];
      return [relative(root, path)];
    });
    expect(importers).toEqual(['src/security/gateway.ts']);
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
