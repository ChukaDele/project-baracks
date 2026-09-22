import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function resolvedManifest(name: string) {
  return {
    version: 1,
    project: {
      name,
      outcome: 'Expose a reliable internal API.',
      primaryAudience: 'Internal engineering team',
    },
    archetype: 'backend-service',
    access: 'none',
    dataSensitivity: 'none',
    commercialModel: 'internal',
    aiRole: 'none',
  };
}

function runBootstrap(scratch: string, target: string, manifestPath: string) {
  return spawnSync(
    'bash',
    ['scripts/bootstrap-major-project.sh', target, 'full', 'figma', manifestPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAJOR_HOME: join(scratch, 'major-home'),
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
      encoding: 'utf8',
    },
  );
}

function expectNoProjectMutation(target: string) {
  for (const path of [
    'PROJECT.md',
    'GOAL_STATE.md',
    'STATUS.md',
    'LEARNINGS.md',
    'QUALITY.md',
    'DISCOVERY.md',
    'ARCHITECTURE.md',
    'SKILLS.md',
    'AGENTS.md',
    'CLAUDE.md',
  ]) {
    expect(existsSync(join(target, path))).toBe(false);
  }
  expect(existsSync(join(target, '.agents'))).toBe(false);
}

describe('Foundry bootstrap', () => {
  it('rejects a conflicting existing manifest before mutating project files', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-foundry-bootstrap-'));
    const target = join(scratch, 'project');
    const manifestPath = join(scratch, 'incoming.json');
    const existing = resolvedManifest('Existing Project');
    const incoming = resolvedManifest('Different Project');

    try {
      mkdirSync(join(target, '.foundry'), { recursive: true });
      writeFileSync(join(target, '.foundry', 'project.json'), JSON.stringify(existing, null, 2));
      writeFileSync(manifestPath, JSON.stringify(incoming, null, 2));

      const result = runBootstrap(scratch, target, manifestPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        'existing .foundry/project.json differs; refusing to overwrite project truth',
      );
      expect(JSON.parse(readFileSync(join(target, '.foundry', 'project.json'), 'utf8'))).toEqual(
        existing,
      );
      expectNoProjectMutation(target);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked project target through installer preflight before mutation', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-foundry-bootstrap-'));
    const external = join(scratch, 'external-project');
    const target = join(scratch, 'project-link');
    const manifestPath = join(scratch, 'incoming.json');

    try {
      mkdirSync(external, { recursive: true });
      symlinkSync(external, target);
      writeFileSync(manifestPath, JSON.stringify(resolvedManifest('Target Symlink Test'), null, 2));

      const result = runBootstrap(scratch, target, manifestPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('refusing symlinked project target');
      expectNoProjectMutation(target);
      expect(existsSync(join(external, '.foundry'))).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a non-directory .foundry authority before mutating project files', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-foundry-bootstrap-'));
    const target = join(scratch, 'project');
    const manifestPath = join(scratch, 'incoming.json');

    try {
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, '.foundry'), 'not a directory\n');
      writeFileSync(manifestPath, JSON.stringify(resolvedManifest('Foundry File Test'), null, 2));

      const result = runBootstrap(scratch, target, manifestPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('.foundry project authority must be a directory');
      expect(readFileSync(join(target, '.foundry'), 'utf8')).toBe('not a directory\n');
      expectNoProjectMutation(target);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked .foundry authority before writing outside the project', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-foundry-bootstrap-'));
    const target = join(scratch, 'project');
    const external = join(scratch, 'external-foundry');
    const manifestPath = join(scratch, 'incoming.json');

    try {
      mkdirSync(target, { recursive: true });
      mkdirSync(external, { recursive: true });
      symlinkSync(external, join(target, '.foundry'));
      writeFileSync(manifestPath, JSON.stringify(resolvedManifest('Symlink Test'), null, 2));

      const result = runBootstrap(scratch, target, manifestPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Foundry project authority must not be symlinked');
      expect(existsSync(join(external, 'project.json'))).toBe(false);
      expectNoProjectMutation(target);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked project manifest before following it outside the project', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-foundry-bootstrap-'));
    const target = join(scratch, 'project');
    const external = join(scratch, 'external-project.json');
    const manifestPath = join(scratch, 'incoming.json');

    try {
      mkdirSync(join(target, '.foundry'), { recursive: true });
      writeFileSync(external, 'external sentinel\n');
      symlinkSync(external, join(target, '.foundry', 'project.json'));
      writeFileSync(manifestPath, JSON.stringify(resolvedManifest('Symlink File Test'), null, 2));

      const result = runBootstrap(scratch, target, manifestPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('Foundry project authority must not be symlinked');
      expect(readFileSync(external, 'utf8')).toBe('external sentinel\n');
      expectNoProjectMutation(target);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
