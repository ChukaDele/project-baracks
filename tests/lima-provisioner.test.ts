import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const provisioner = resolve('scripts/provision-major-lima-worker.sh');

function fakeLima(root: string, instance = 'major-worker'): string {
  const path = join(root, 'limactl');
  writeFileSync(
    path,
    `#!/bin/sh
set -eu
state="$MAJOR_FAKE_LIMA_STATE"
log="$MAJOR_FAKE_LIMA_LOG"
printf '%s\\n' "$*" >> "$log"
case "$1" in
  list) if [ -f "$state" ]; then
    if [ "\${MAJOR_FAKE_LIMA_LARGE_LIST:-0}" = 1 ]; then
      i=0; while [ "$i" -lt 5000 ]; do printf '{"name":"filler-%s","status":"Stopped"}\n' "$i"; i=$((i + 1)); done
    fi
    mounts='[]'; [ "\${MAJOR_FAKE_LIMA_UNSAFE:-0}" = 1 ] && mounts='[{"location":"/Users"}]'
    printf '{"name":"${instance}","status":"%s","vmType":"vz","arch":"aarch64","sshAddress":"127.0.0.1","config":{"plain":true,"mounts":%s,"portForwards":[],"networks":[],"propagateProxyEnv":false,"containerd":{"system":false,"user":false},"ssh":{"forwardAgent":false,"forwardX11":false,"forwardX11Trusted":false,"loadDotSSHPubKeys":false}}}\\n' "$(cat "$state")" "$mounts"
    if [ "\${MAJOR_FAKE_LIMA_AUTH_SOURCE:-0}" = 1 ]; then
      printf '{"name":"major-worker","status":"%s"}\\n' "\${MAJOR_FAKE_LIMA_SOURCE_STATUS:-Running}"
    fi
  fi ;;
  create) printf 'Stopped' > "$state" ;;
  start) [ "\${2:-}" = major-worker ] || printf 'Running' > "$state" ;;
  stop)
    if [ "\${2:-}" = major-worker ]; then
      [ "\${MAJOR_FAKE_LIMA_FAIL_SOURCE_STOP:-0}" = 1 ] && exit 38
      exit 0
    else
      printf 'Stopped' > "$state"
    fi ;;
  delete) rm -f "$state" ;;
  copy) : ;;
  shell)
    if [ "\${MAJOR_FAKE_LIMA_AUTH_SOURCE:-0}" = 1 ] && [ "$3" = major-worker ] && echo "$*" | grep -q 'tar -C /var/lib/major/provider-auth -cf -'; then
      printf 'opaque-provider-auth'
      exit 0
    fi
    if [ "\${MAJOR_FAKE_LIMA_AUTH_MISSING:-0}" = 1 ] && [ "$3" = major-worker ] && echo "$*" | grep -q 'test -f /var/lib/major/provider-auth'; then
      exit 1
    fi
    if echo "$*" | grep -q "stat -c %U:%G:%a"; then
      case "$*" in
        *provider-auth/codex/*) printf 'root:major-codex:440\\n' ;;
        *provider-auth/cursor/*) printf 'root:major-cursor:440\\n' ;;
        *provider-auth/antigravity/*) printf 'root:major-antigravity:440\\n' ;;
      esac
      exit 0
    fi
    if [ "\${MAJOR_FAKE_LIMA_AUTH_SOURCE:-0}" = 1 ] && echo "$*" | grep -q 'tar -C /var/lib/major/provider-auth -xf -'; then
      cat >/dev/null
      : > "$state.auth-migrated"
      exit 0
    fi
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

function run(
  root: string,
  extraEnv: Record<string, string> = {},
  instance = 'major-worker',
  releaseSha = 'legacy-v1',
) {
  return spawnSync('bash', [provisioner, fakeLima(root, instance), instance, releaseSha], {
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
    expect(log.match(/bootstrap-major-lima-worker\.sh/g)).toHaveLength(1);
  });

  it('consumes a large Lima list without SIGPIPE under pipefail', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-large-list-'));
    roots.push(root);
    expect(run(root, { MAJOR_FAKE_LIMA_LARGE_LIST: '1' }).status).toBe(0);
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

  it('reuses a healthy existing worker without mutating it', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-existing-'));
    roots.push(root);
    writeFileSync(join(root, 'state'), 'Stopped');
    writeFileSync(`${join(root, 'state')}.providers`, 'ready');
    expect(run(root, { MAJOR_FAKE_LIMA_FAIL_BOOTSTRAP: '1' }).status).toBe(0);
    expect(readFileSync(join(root, 'state'), 'utf8')).toBe('Stopped');
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).not.toMatch(/bootstrap-major-lima-worker/);
    expect(log).not.toMatch(/delete --force/);
  });

  it('refuses an incomplete existing worker without mutating or deleting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-incomplete-'));
    roots.push(root);
    writeFileSync(join(root, 'state'), 'Stopped');
    const failed = run(root);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/refusing in-place mutation/);
    expect(readFileSync(join(root, 'state'), 'utf8')).toBe('Stopped');
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).not.toMatch(/bootstrap-major-lima-worker/);
    expect(log).not.toMatch(/delete --force/);
  });

  it('accepts a release-specific worker name', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-release-'));
    roots.push(root);
    const instance = 'major-worker-0123456789ab';
    expect(run(root, {}, instance, '0'.repeat(40)).status).toBe(0);
    expect(readFileSync(join(root, 'log'), 'utf8')).toMatch(
      /create --name major-worker-0123456789ab/,
    );
  });

  it('streams only the exact approved provider credentials between VMs', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-auth-'));
    roots.push(root);
    const instance = 'major-worker-0123456789ab';
    const result = run(root, { MAJOR_FAKE_LIMA_AUTH_SOURCE: '1' }, instance, '0'.repeat(40));
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(`${join(root, 'state')}.auth-migrated`, 'utf8')).toBe('');
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(
      log.match(/major-worker sudo tar -C \/var\/lib\/major\/provider-auth -cf -/g),
    ).toHaveLength(3);
    expect(log).toContain('codex/.codex/auth.json');
    expect(log).toContain('cursor/.config/cursor/auth.json');
    expect(log).toContain('antigravity/.gemini/antigravity-cli/antigravity-oauth-token');
    expect(log).not.toContain('claude/.claude/.credentials.json');
    expect(log.match(new RegExp(`shell --tty=false ${instance} sudo tar`, 'g'))).toHaveLength(3);
    expect(log.match(/sudo chmod 0440/g)).toHaveLength(3);
    expect(log.match(/sudo stat -c %U:%G:%a/g)).toHaveLength(3);
    expect(log).not.toMatch(/\/Users\//);
  });

  it('does not fail installation when authorised provider credentials are absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-no-auth-'));
    roots.push(root);
    const result = run(
      root,
      { MAJOR_FAKE_LIMA_AUTH_SOURCE: '1', MAJOR_FAKE_LIMA_AUTH_MISSING: '1' },
      'major-worker-0123456789ab',
      '0'.repeat(40),
    );
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'log'), 'utf8')).not.toMatch(/provider-auth -cf -/);
  });

  it('fails closed and retries when a stopped credential source cannot be restored', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-source-stop-'));
    roots.push(root);
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_FAKE_LIMA_FAIL_SOURCE_STOP: '1',
      },
      'major-worker-0123456789ab',
      '0'.repeat(40),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/failed to restore legacy major-worker to Stopped/);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).toMatch(/start major-worker/);
    expect(log.match(/stop major-worker/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses reuse when the effective VM isolation contract is unsafe', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-unsafe-'));
    roots.push(root);
    writeFileSync(join(root, 'state'), 'Stopped');
    writeFileSync(`${join(root, 'state')}.providers`, 'ready');
    const failed = run(root, { MAJOR_FAKE_LIMA_UNSAFE: '1' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/unsafe existing Lima instance/);
    expect(readFileSync(join(root, 'state'), 'utf8')).toBe('Stopped');
  });
});
