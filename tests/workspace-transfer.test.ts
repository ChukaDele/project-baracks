import { mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotWorkspace, validateWorkspaceTree } from '../src/execution/workspace-transfer.js';

function temp(name: string): string {
  return mkdtempSync(join(tmpdir(), name));
}

describe('Lima workspace quarantine', () => {
  it('copies project inputs without Git metadata or dependency trees', () => {
    const source = temp('major-source-');
    const output = temp('major-output-');
    writeFileSync(join(source, 'README.md'), 'safe\n');
    mkdirSync(join(source, '.git'));
    writeFileSync(join(source, '.git', 'config'), 'private\n');
    mkdirSync(join(source, 'node_modules'));
    writeFileSync(join(source, 'node_modules', 'package.js'), 'private\n');
    snapshotWorkspace(source, output);
    expect(validateWorkspaceTree(output)).toEqual({ entries: 1, bytes: 5 });
  });

  it('preserves safe relative symlinks when snapshotting a workspace', () => {
    const source = temp('major-source-');
    const output = temp('major-output-');
    mkdirSync(join(source, '.agents', 'skills', 'safe'), { recursive: true });
    mkdirSync(join(source, '.claude', 'skills'), { recursive: true });
    writeFileSync(join(source, '.agents', 'skills', 'safe', 'SKILL.md'), 'safe\n');
    symlinkSync('../../.agents/skills/safe', join(source, '.claude', 'skills', 'safe'));

    snapshotWorkspace(source, output);

    expect(readlinkSync(join(output, '.claude', 'skills', 'safe'))).toBe(
      '../../.agents/skills/safe',
    );
    expect(() => validateWorkspaceTree(output)).not.toThrow();
  });

  it('rejects absolute and escaping symlinks', () => {
    const absolute = temp('major-return-');
    symlinkSync('/etc/passwd', join(absolute, 'escape'));
    expect(() => validateWorkspaceTree(absolute)).toThrow(/absolute symlink/);

    const relative = temp('major-return-');
    symlinkSync('../outside', join(relative, 'escape'));
    expect(() => validateWorkspaceTree(relative)).toThrow(/escaping symlink/);
  });

  it('rejects protected paths and special filesystem objects', () => {
    const protectedTree = temp('major-return-');
    mkdirSync(join(protectedTree, '.git'));
    expect(() => validateWorkspaceTree(protectedTree)).toThrow(/protected path/);

    const fifoTree = temp('major-return-');
    const fifo = join(fifoTree, 'pipe');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    expect(() => validateWorkspaceTree(fifoTree)).toThrow(/unsupported filesystem object/);
  });

  it('rejects pathologically deep returned trees', () => {
    const root = temp('major-return-');
    let directory = root;
    for (let depth = 0; depth < 130; depth += 1) {
      directory = join(directory, 'd');
      mkdirSync(directory);
    }
    expect(() => validateWorkspaceTree(root)).toThrow(/directory depth limit/);
  });
});
