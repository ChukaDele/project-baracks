import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const provisioner = resolve('scripts/provision-major-lima-worker.sh');

function fakeLima(root: string): string {
  const path = join(root, 'limactl');
  writeFileSync(
    path,
    `#!/bin/sh
set -eu
state="$MAJOR_FAKE_LIMA_STATE"
log="$MAJOR_FAKE_LIMA_LOG"
printf '%s\\n' "$*" >> "$log"
case "$1" in
  list) if [ -f "$state" ]; then printf '{"name":"major-worker","status":"%s"}\\n' "$(cat "$state")"; fi ;;
  create) printf 'Stopped' > "$state" ;;
  start) printf 'Running' > "$state" ;;
  stop) printf 'Stopped' > "$state" ;;
  delete) rm -f "$state" ;;
  copy) : ;;
  shell)
    if echo "$*" | grep -q 'test -x /opt/major/providers' && [ ! -f "$state.providers" ]; then
      exit 1
    fi
    if echo "$*" | grep -q install-major-linux-providers; then
      : > "$state.providers"
    fi
    if [ "\${MAJOR_FAKE_LIMA_FAIL_BOOTSTRAP:-0}" = 1 ] && echo "$*" | grep -q bootstrap-major; then
      exit 37
    fi
    if echo "$*" | grep -q bootstrap-major; then
      : > "$state.providers"
    fi
    ;;
  --version) : ;;
  *) exit 64 ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function run(root: string, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [provisioner, fakeLima(root), 'major-worker'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MAJOR_FAKE_LIMA_STATE: join(root, 'state'),
      MAJOR_FAKE_LIMA_LOG: join(root, 'log'),
      ...extraEnv,
    },
  });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('clean-install Lima provisioning', () => {
  it('creates, verifies and stops a new worker, then reuses it idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-'));
    roots.push(root);
    const first = run(root);
    expect(first.status).toBe(0);
    expect(readFileSync(join(root, 'state'), 'utf8')).toBe('Stopped');
    expect(run(root).status).toBe(0);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log.match(/^create /gm)).toHaveLength(1);
    expect(log.match(/install-major-linux-providers\.sh/g)).toHaveLength(1);
    expect(log.match(/bootstrap-major-lima-worker\.sh/g)).toHaveLength(2);
  });

  it('pins official Linux arm64 artifacts and never executes a remote installer', () => {
    const source = readFileSync(resolve('scripts/install-major-linux-providers.sh'), 'utf8');
    expect(source).toContain('claude_version=2.1.228');
    expect(source).toContain('codex_version=0.147.0');
    expect(source).toContain('cursor_version=2026.08.11-e8db854');
    expect(source).toContain('antigravity_version=1.1.12');
    expect(source).toMatch(/verify_sha256 "\$claude_sha256"/);
    expect(source).toMatch(/verify_sha256 "\$codex_sha256"/);
    expect(source).toMatch(/verify_sha256 "\$cursor_sha256"/);
    expect(source).toMatch(/verify_sha512 "\$antigravity_sha512"/);
    expect(source).not.toMatch(/curl[^\n]*\|\s*(ba)?sh/);
  });

  it('migrates only each exact authorised credential file through sudo', () => {
    const source = readFileSync(resolve('scripts/bootstrap-major-lima-worker.sh'), 'utf8');
    expect(source).toContain('sudo test -f "$auth_source"');
    expect(source).toContain('sudo test ! -L "$auth_source"');
    expect(source).toContain(
      'sudo install -m 0440 -o root -g "$user" "$auth_source" "$auth_target"',
    );
  });

  it('deletes only a newly created worker when bootstrap fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-fail-'));
    roots.push(root);
    const failed = run(root, { MAJOR_FAKE_LIMA_FAIL_BOOTSTRAP: '1' });
    expect(failed.status).toBe(37);
    expect(() => readFileSync(join(root, 'state'))).toThrow();
    expect(readFileSync(join(root, 'log'), 'utf8')).toMatch(/delete --force major-worker/);
  });

  it('preserves an existing worker when reprovisioning fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-existing-'));
    roots.push(root);
    writeFileSync(join(root, 'state'), 'Stopped');
    expect(run(root, { MAJOR_FAKE_LIMA_FAIL_BOOTSTRAP: '1' }).status).toBe(37);
    expect(readFileSync(join(root, 'state'), 'utf8')).toBe('Running');
    expect(readFileSync(join(root, 'log'), 'utf8')).not.toMatch(/delete --force/);
  });
});
