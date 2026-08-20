import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHarnessCli } from '../src/harness/cli.js';
import { conformancePassed, runHarnessConformance } from '../src/harness/conformance.js';
import { buildHarnessInstallPlan } from '../src/harness/install-plan.js';
import {
  WORKSTATION_LISTEN_HOST,
  WORKSTATION_PORT,
  WORKSTATION_PROFILE,
  buildWorkstationAppPlan,
} from '../src/harness/workstation-app.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const STAGE = resolve(REPO_ROOT, 'scripts/stage-major-workstation-app.sh');
const START = resolve(REPO_ROOT, 'scripts/start-major-workstation.sh');
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    execFileSync('rm', ['-rf', home]);
  }
});

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'major-dsh-home-'));
  homes.push(home);
  return home;
}

function fakeExec(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function bash(
  args: string[],
  env: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('Major DSH workstation app', () => {
  it('WRAPS official DSH web boot and BORROWS Chrome app-mode', () => {
    const plan = buildWorkstationAppPlan();
    expect(plan.profile).toBe(WORKSTATION_PROFILE);
    expect(plan.listen).toBe(`${WORKSTATION_LISTEN_HOST}:${WORKSTATION_PORT}`);
    expect(plan.chromeAppUrl).toBe('http://localhost:3080');
    expect(plan.dshCommand).toContain('--no-open');
    expect(plan.dshCommand).toContain('--host 127.0.0.1');
    expect(plan.chromeCommand).toContain('--app=http://localhost:3080');
    expect(plan.autoStartDaemon).toBe(false);
    expect(plan.preservesMajorPath).toBe(true);
    expect(plan.liveTrafficRemains).toBe('lima-cli-acp');
    expect(buildHarnessInstallPlan(REPO_ROOT).commands.join('\n')).toContain('Major.app');
  });

  it('dry-runs the reversible app stager without mutating the home', () => {
    const root = isolatedHome();
    const home = join(root, 'dsh-must-not-exist');
    const appDir = join(root, 'apps-must-not-exist');
    const output = execFileSync('bash', [STAGE, '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, MAJOR_DSH_HOME: home, MAJOR_APP_DIR: appDir },
    });
    expect(output).toContain('[dry-run] stage');
    expect(output).toContain('Major.app');
    expect(output).toContain('preserve live Major path');
    expect(existsSync(home)).toBe(false);
    expect(existsSync(appDir)).toBe(false);
  });

  it('defaults app placement to an isolated HOME/Applications', () => {
    const root = isolatedHome();
    const home = join(root, 'dsh');
    const result = bash([STAGE], { HOME: root, MAJOR_DSH_HOME: home, MAJOR_APP_DIR: '' });
    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'Applications/Major.app/Contents/MacOS/Major'))).toBe(true);
    expect(existsSync(join(home, 'bin/start-major-workstation.sh'))).toBe(true);
  });

  it('stages the marked app separately, points it at DSH state, and removes only owned files', () => {
    const home = isolatedHome();
    const appDir = join(home, 'Applications');
    const app = join(appDir, 'Major.app');
    mkdirSync(join(home, 'runtime'), { recursive: true });
    writeFileSync(join(home, 'runtime', 'keep-pin'), 'pin-runtime\n');
    const staged = bash([STAGE], { MAJOR_DSH_HOME: home, MAJOR_APP_DIR: appDir });
    expect(staged.status).toBe(0);
    expect(existsSync(join(app, 'Contents/MacOS/Major'))).toBe(true);
    expect(readFileSync(join(app, 'Contents/Resources/major-dsh-installer-owned'), 'utf8')).toBe(
      'major-dsh-workstation-app-v1\n',
    );
    expect(readFileSync(join(app, 'Contents/Resources/major-dsh-home'), 'utf8')).toBe(`${home}\n`);
    expect(existsSync(join(home, 'bin/start-major-workstation.sh'))).toBe(true);
    expect(readFileSync(join(home, 'runtime', 'keep-pin'), 'utf8')).toBe('pin-runtime\n');
    const removed = bash([STAGE, '--remove'], {
      MAJOR_DSH_HOME: home,
      MAJOR_APP_DIR: appDir,
    });
    expect(removed.status).toBe(0);
    expect(existsSync(app)).toBe(false);
    expect(existsSync(join(home, 'runtime', 'keep-pin'))).toBe(true);
    expect(removed.stdout).toContain('live Major execution remains on Lima');
  });

  it('refuses to overwrite or remove a pre-existing unmarked Major.app', () => {
    const home = isolatedHome();
    const appDir = join(home, 'Applications');
    const app = join(appDir, 'Major.app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'user-owned'), 'keep me\n');

    for (const args of [[STAGE], [STAGE, '--remove']]) {
      const result = bash(args, { MAJOR_DSH_HOME: home, MAJOR_APP_DIR: appDir });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('refusing to overwrite or remove');
      expect(readFileSync(join(app, 'user-owned'), 'utf8')).toBe('keep me\n');
    }
    expect(existsSync(join(home, 'bin/start-major-workstation.sh'))).toBe(false);
  });

  it('replaces only a marked app and the app executable uses its staged pointer', () => {
    const home = isolatedHome();
    const appDir = join(home, 'Applications');
    const app = join(appDir, 'Major.app');
    expect(bash([STAGE], { MAJOR_DSH_HOME: home, MAJOR_APP_DIR: appDir }).status).toBe(0);
    writeFileSync(join(app, 'obsolete-installer-file'), 'replace me\n');
    expect(bash([STAGE], { MAJOR_DSH_HOME: home, MAJOR_APP_DIR: appDir }).status).toBe(0);
    expect(existsSync(join(app, 'obsolete-installer-file'))).toBe(false);

    const project = mkdtempSync(join(tmpdir(), 'major-project-'));
    homes.push(project);
    const result = bash([join(app, 'Contents/MacOS/Major'), '--dry-run', '--project', project], {
      MAJOR_DSH_HOME: '/must/not/control/the/staged/app',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`dsh home: ${home}`);
  });

  it('dry-runs start for a real project directory without writing a lock', () => {
    const home = isolatedHome();
    const project = mkdtempSync(join(tmpdir(), 'major-project-'));
    homes.push(project);
    const result = bash([START, '--dry-run', '--project', project], { MAJOR_DSH_HOME: home });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mode: dry-run');
    expect(result.stdout).toContain('listen: 127.0.0.1:3080');
    expect(result.stdout).toContain('--app=http://localhost:3080');
    expect(result.stdout).toContain(project);
    expect(result.stdout).toContain('preserve PATH');
    expect(result.stdout).toContain('no Electron');
    expect(existsSync(join(home, 'run/workstation.lock'))).toBe(false);
  });

  it('starts one fake DSH process, refuses duplicates, logs under the home, and stops cleanly', async () => {
    const home = isolatedHome();
    const project = mkdtempSync(join(tmpdir(), 'major-project-'));
    homes.push(project);
    const bin = join(home, 'fakes');
    fakeExec(bin, 'dsh', 'echo "fake-dsh $*"; while :; do sleep 1; done');
    fakeExec(bin, 'chrome', 'echo "fake-chrome $*"; while :; do sleep 1; done');
    const env = {
      ...process.env,
      MAJOR_DSH_HOME: home,
      MAJOR_DSH_BIN: join(bin, 'dsh'),
      MAJOR_CHROME_BIN: join(bin, 'chrome'),
      MAJOR_WORKSTATION_READY_TIMEOUT: '0',
    };
    const child = spawn('bash', [START, '--project', project], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ready = join(home, 'run/workstation.lock/ready');
    const startedAt = Date.now();
    while (!existsSync(ready)) {
      if (Date.now() - startedAt > 8000) {
        child.kill('SIGTERM');
        throw new Error('workstation did not become ready');
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const log = join(home, 'logs/workstation.log');
      while (!readFileSync(log, 'utf8').includes('fake-dsh')) {
        if (Date.now() - startedAt > 8000) throw new Error('fake DSH output was not logged');
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(existsSync(join(home, 'run/workstation.lock/dsh.pid'))).toBe(true);
      expect(readFileSync(log, 'utf8')).toContain('fake-dsh');
      expect(readFileSync(join(home, 'run/current-project'), 'utf8').trim()).toBe(project);
      const duplicate = bash([START, '--project', project], {
        MAJOR_DSH_HOME: home,
        MAJOR_DSH_BIN: join(bin, 'dsh'),
        MAJOR_CHROME_BIN: join(bin, 'chrome'),
        MAJOR_WORKSTATION_READY_TIMEOUT: '0',
      });
      expect(duplicate.status).not.toBe(0);
      expect(`${duplicate.stdout}${duplicate.stderr}`).toMatch(/already running/);
    } finally {
      const stopped = bash([START, '--stop'], { MAJOR_DSH_HOME: home });
      expect(stopped.status).toBe(0);
      expect(existsSync(join(home, 'run/workstation.lock'))).toBe(false);
    }
    await new Promise<void>((resolveExit) => {
      child.on('close', () => resolveExit());
      setTimeout(resolveExit, 3000);
    });
  });
});

describe('major harness workstation-app CLI', () => {
  it('prints the workstation plan', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    try {
      expect(await runHarnessCli(['harness', 'workstation-app'])).toBe(true);
      expect(logs.join('\n')).toContain('profile: major-workstation-web');
      expect(logs.join('\n')).toContain('listen: 127.0.0.1:3080');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps shadow conformance including the workstation app', () => {
    const report = runHarnessConformance(REPO_ROOT);
    expect(report.checks.filter((item) => !item.ok)).toEqual([]);
    expect(conformancePassed(report)).toBe(true);
    expect(report.checks.some((item) => item.id === 'workstation.chrome-app-mode' && item.ok)).toBe(
      true,
    );
  });
});
