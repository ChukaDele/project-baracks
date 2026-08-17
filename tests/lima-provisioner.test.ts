import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
source_instance="\${MAJOR_FAKE_LIMA_SOURCE_INSTANCE:-major-worker}"
printf '%s\\n' "$*" >> "$log"
case "$1" in
  list) if [ -f "$state" ]; then
    if [ "\${MAJOR_FAKE_LIMA_LARGE_LIST:-0}" = 1 ]; then
      i=0; while [ "$i" -lt 5000 ]; do printf '{"name":"filler-%s","status":"Stopped"}\n' "$i"; i=$((i + 1)); done
    fi
    mounts='[]'; [ "\${MAJOR_FAKE_LIMA_UNSAFE:-0}" = 1 ] && mounts='[{"location":"/Users"}]'
    printf '{"name":"${instance}","status":"%s","vmType":"vz","arch":"aarch64","sshAddress":"127.0.0.1","config":{"plain":true,"mounts":%s,"portForwards":[],"networks":[],"propagateProxyEnv":false,"containerd":{"system":false,"user":false},"ssh":{"forwardAgent":false,"forwardX11":false,"forwardX11Trusted":false,"loadDotSSHPubKeys":false}}}\\n' "$(cat "$state")" "$mounts"
    if [ "\${MAJOR_FAKE_LIMA_AUTH_SOURCE:-0}" = 1 ]; then
      printf '{"name":"%s","status":"%s"}\\n' "$source_instance" "\${MAJOR_FAKE_LIMA_SOURCE_STATUS:-Running}"
    fi
  fi ;;
  create) printf 'Stopped' > "$state" ;;
  start)
    if [ "\${2:-}" = "$source_instance" ]; then
      if [ "\${MAJOR_FAKE_LIMA_SOURCE_START_FAILS:-0}" = 1 ]; then
        exit 7
      fi
      if [ "\${MAJOR_FAKE_LIMA_SOURCE_START_HANGS:-0}" = 1 ]; then
        if [ "\${MAJOR_FAKE_LIMA_SOURCE_START_SPEWS:-0}" = 1 ]; then
          while true; do
            echo '[hostagent] vsock forwarder accept error: accept tcp 127.0.0.1:0: accept: bad file descriptor' >&2
          done
        else
          sleep 300
        fi
      fi
    else
      printf 'Running' > "$state"
    fi
    ;;
  stop)
    if [ "\${2:-}" = "$source_instance" ]; then
      [ "\${MAJOR_FAKE_LIMA_FAIL_SOURCE_STOP:-0}" = 1 ] && exit 38
      exit 0
    else
      printf 'Stopped' > "$state"
    fi ;;
  delete) rm -f "$state" ;;
  copy) : ;;
  shell)
    if [ "\${MAJOR_FAKE_LIMA_SOURCE_MARKER_MISSING:-0}" = 1 ] && [ "$3" = "$source_instance" ] && echo "$*" | grep -q 'test -f /opt/major/releases/'; then
      exit 1
    fi
    if [ "\${MAJOR_FAKE_LIMA_AUTH_SOURCE:-0}" = 1 ] && [ "$3" = "$source_instance" ] && echo "$*" | grep -q 'tar -C /var/lib/major/provider-auth -cf -'; then
      printf 'opaque-provider-auth'
      exit 0
    fi
    if [ "\${MAJOR_FAKE_LIMA_AUTH_MISSING:-0}" = 1 ] && [ "$3" = "$source_instance" ] && echo "$*" | grep -q 'test -f /var/lib/major/provider-auth'; then
      exit 1
    fi
    if echo "$*" | grep -q "stat -c %U:%G:%a"; then
      case "$*" in
        */opt/major/releases/*) printf 'root:root:444\\n' ;;
        *provider-auth/claude/*) printf 'root:major-claude:440\\n' ;;
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
  script = provisioner,
) {
  return spawnSync('bash', [script, fakeLima(root, instance), instance, releaseSha], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MAJOR_FAKE_LIMA_STATE: join(root, 'state'),
      MAJOR_FAKE_LIMA_LOG: join(root, 'log'),
      ...extraEnv,
    },
  });
}

function authorizedProvisioner(root: string): string {
  const bundle = join(root, 'bundle');
  const scripts = join(bundle, 'scripts');
  mkdirSync(join(bundle, 'templates', 'apparmor'), { recursive: true });
  mkdirSync(join(bundle, 'templates', 'lima'), { recursive: true });
  const script = join(scripts, 'provision-major-lima-worker.sh');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(script, readFileSync(provisioner));
  for (const name of [
    'bootstrap-major-lima-worker.sh',
    'install-major-linux-providers.sh',
    'configure-major-antigravity-run.py',
    'manage-major-provider-state.py',
  ])
    writeFileSync(join(scripts, name), '# fixture\n');
  writeFileSync(join(bundle, 'templates', 'apparmor', 'major-cursor-sandbox'), '# fixture\n');
  writeFileSync(join(bundle, 'templates', 'lima', 'major-worker.yaml'), '# fixture\n');
  writeFileSync(
    join(scripts, 'verify-secure-enclave-staged-validation-lease.mjs'),
    `const args = process.argv.slice(2);\nif (args[3] !== 'credential-handoff' || !['claude','codex','cursor','antigravity'].includes(args[4])) process.exit(1);\n`,
  );
  return script;
}

function workshopAuthorizedProvisioner(root: string): string {
  const script = authorizedProvisioner(root);
  const bundle = resolve(script, '..', '..');
  mkdirSync(join(bundle, 'dist'), { recursive: true });
  writeFileSync(
    join(bundle, 'dist', 'entry.js'),
    `const args = process.argv.slice(2);
if (args[0] !== 'session' || args[1] !== 'verify-handoff') process.exit(1);
const provider = args[args.indexOf('--provider') + 1];
const sha = args[args.indexOf('--release-sha') + 1];
const instance = args[args.indexOf('--destination-instance') + 1];
if (!['claude','codex','cursor','antigravity'].includes(provider) || instance !== 'major-worker-' + sha.slice(0, 12)) process.exit(1);
`,
  );
  rmSync(join(bundle, 'scripts', 'verify-secure-enclave-staged-validation-lease.mjs'));
  return script;
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
    expect(run(root, {}, instance, `0123456789ab${'0'.repeat(28)}`).status).toBe(0);
    expect(readFileSync(join(root, 'log'), 'utf8')).toMatch(
      /create --name major-worker-0123456789ab/,
    );
  });

  it('requires signed release authority before streaming provider credentials', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-auth-'));
    roots.push(root);
    const instance = 'major-worker-0123456789ab';
    const result = run(
      root,
      { MAJOR_FAKE_LIMA_AUTH_SOURCE: '1' },
      instance,
      `0123456789ab${'0'.repeat(28)}`,
    );
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).not.toMatch(/provider-auth -cf -/);
    expect(log).not.toMatch(/\/Users\/[^\s]+\/\.(?:claude|codex|config\/cursor|gemini)\//);
  });

  it('binds the exact four provider credential paths to Secure Enclave release authority', () => {
    const source = readFileSync(provisioner, 'utf8');
    expect(source).toContain('claude:claude/.claude/.credentials.json');
    expect(source).toContain('codex:codex/.codex/auth.json');
    expect(source).toContain('cursor:cursor/.config/cursor/auth.json');
    expect(source).toContain(
      'antigravity:antigravity/.gemini/antigravity-cli/antigravity-oauth-token',
    );
    expect(source).toContain('verify-secure-enclave-staged-validation-lease.mjs');
    expect(source).toContain('"$RELEASE_SHA" credential-handoff "$provider"');
  });

  it('streams all four credentials only through an exact-SHA authorized handoff', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-authorized-auth-'));
    roots.push(root);
    const sha = '0'.repeat(40);
    const instance = 'major-worker-000000000000';
    const result = run(
      root,
      { MAJOR_FAKE_LIMA_AUTH_SOURCE: '1' },
      instance,
      sha,
      authorizedProvisioner(root),
    );
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(
      log.match(/major-worker sudo tar -C \/var\/lib\/major\/provider-auth -cf -/g),
    ).toHaveLength(4);
    for (const path of [
      'claude/.claude/.credentials.json',
      'codex/.codex/auth.json',
      'cursor/.config/cursor/auth.json',
      'antigravity/.gemini/antigravity-cli/antigravity-oauth-token',
    ])
      expect(log).toContain(path);
    expect(log.match(new RegExp(`shell --tty=false ${instance} sudo tar`, 'g'))).toHaveLength(4);
    expect(log.match(/sudo chmod 0440/g)).toHaveLength(4);
    expect(log.match(/sudo stat -c %U:%G:%a/g)).toHaveLength(4);
    expect(log).not.toMatch(/\/Users\//);
  }, 10_000);

  it('reuses all four credentials under one active supervised Workshop session', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-workshop-auth-'));
    roots.push(root);
    const sha = '1'.repeat(40);
    const instance = 'major-worker-111111111111';
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_WORKSHOP_AUTH_CWD: root,
        MAJOR_WORKSHOP_SESSION_ID: 'thread-123',
      },
      instance,
      sha,
      workshopAuthorizedProvisioner(root),
    );
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log.match(/sudo tar -C \/var\/lib\/major\/provider-auth -cf -/g)).toHaveLength(4);
    expect(log.match(/sudo chmod 0440/g)).toHaveLength(4);
    expect(log).not.toMatch(/\/Users\//);
  }, 10_000);

  it('can source authorised credentials from an exact prior release worker', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-prior-auth-'));
    roots.push(root);
    const destinationSha = '0'.repeat(40);
    const sourceSha = `123456789abc${'0'.repeat(28)}`;
    const sourceInstance = 'major-worker-123456789abc';
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_INSTANCE: sourceInstance,
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_PROVIDER_AUTH_SOURCE_INSTANCE: sourceInstance,
        MAJOR_PROVIDER_AUTH_SOURCE_SHA: sourceSha,
      },
      'major-worker-000000000000',
      destinationSha,
      authorizedProvisioner(root),
    );
    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).toContain(
      `shell --tty=false ${sourceInstance} sudo test -f /opt/major/releases/${sourceSha}`,
    );
    expect(log.indexOf(`start ${sourceInstance}`)).toBeLessThan(
      log.indexOf(`shell --tty=false ${sourceInstance} sudo test -f`),
    );
    expect(log).toContain(`stop ${sourceInstance}`);
    expect(
      log.match(
        new RegExp(`${sourceInstance} sudo tar -C /var/lib/major/provider-auth -cf -`, 'g'),
      ),
    ).toHaveLength(4);
    expect(log).not.toMatch(/shell --tty=false major-worker sudo tar/);
  });

  it('rejects a prior release auth source without its exact release marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-prior-auth-marker-'));
    roots.push(root);
    const sourceSha = `123456789abc${'0'.repeat(28)}`;
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_INSTANCE: 'major-worker-123456789abc',
        MAJOR_FAKE_LIMA_SOURCE_MARKER_MISSING: '1',
        MAJOR_PROVIDER_AUTH_SOURCE_INSTANCE: 'major-worker-123456789abc',
        MAJOR_PROVIDER_AUTH_SOURCE_SHA: sourceSha,
      },
      'major-worker-000000000000',
      '0'.repeat(40),
      authorizedProvisioner(root),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/provider-auth source release marker is missing/);
    expect(readFileSync(join(root, 'log'), 'utf8')).not.toMatch(/provider-auth -cf -/);
  });

  it('does not fail installation when authorised provider credentials are absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-no-auth-'));
    roots.push(root);
    const result = run(
      root,
      { MAJOR_FAKE_LIMA_AUTH_SOURCE: '1', MAJOR_FAKE_LIMA_AUTH_MISSING: '1' },
      'major-worker-0123456789ab',
      `0123456789ab${'0'.repeat(28)}`,
      authorizedProvisioner(root),
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
      `0123456789ab${'0'.repeat(28)}`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/failed to restore provider-auth source major-worker to Stopped/);
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log).toMatch(/start major-worker/);
    expect(log.match(/stop major-worker/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed with an actionable message when the auth-source worker fails to start immediately', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-source-start-fails-'));
    roots.push(root);
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_FAKE_LIMA_SOURCE_START_FAILS: '1',
      },
      'major-worker-0123456789ab',
      `0123456789ab${'0'.repeat(28)}`,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERROR: previous Major worker failed to provide credentials');
    expect(result.stderr).toContain('Worker: major-worker');
    expect(result.stderr).toContain('Existing release was not changed.');
    expect(result.stderr).toContain('Diagnostic log:');
    expect(result.stderr).toContain('major provider connect <provider>');
    // No orphaned destination worker: it was newly created by this run.
    expect(() => readFileSync(join(root, 'state'))).toThrow();
  });

  it('does not hang when the auth-source worker start call never returns, and reports a timeout', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-source-start-hangs-'));
    roots.push(root);
    const started = Date.now();
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_FAKE_LIMA_SOURCE_START_HANGS: '1',
        MAJOR_AUTH_SOURCE_START_TIMEOUT_SECS: '1',
      },
      'major-worker-0123456789ab',
      `0123456789ab${'0'.repeat(28)}`,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERROR: previous Major worker failed to provide credentials');
    // A single bounded attempt, not a hot retry loop.
    const log = readFileSync(join(root, 'log'), 'utf8');
    expect(log.match(/^start major-worker$/gm)).toHaveLength(1);
    // The destination worker created by this run is rolled back, not left orphaned.
    expect(() => readFileSync(join(root, 'state'))).toThrow();
  }, 15_000);

  it('captures a repeated-stderr auth-source start to the diagnostic log instead of flooding stderr', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-source-start-spews-'));
    roots.push(root);
    const result = run(
      root,
      {
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_FAKE_LIMA_SOURCE_START_HANGS: '1',
        MAJOR_FAKE_LIMA_SOURCE_START_SPEWS: '1',
        MAJOR_AUTH_SOURCE_START_TIMEOUT_SECS: '1',
      },
      'major-worker-0123456789ab',
      `0123456789ab${'0'.repeat(28)}`,
    );
    expect(result.status).not.toBe(0);
    // The installer's own stderr stays small and actionable...
    expect(result.stderr.split('\n').length).toBeLessThan(40);
    expect(result.stderr).toContain('vsock forwarder accept error');
    // ...while the full spew is preserved on disk for real diagnosis.
    const logPathMatch = /Diagnostic log: (\S+)/.exec(result.stderr);
    expect(logPathMatch).not.toBeNull();
    const diagnosticLog = readFileSync(logPathMatch![1]!, 'utf8');
    expect(diagnosticLog.match(/vsock forwarder accept error/g)!.length).toBeGreaterThan(20);
  }, 15_000);

  it('kills the in-flight bounded call and restores the source on SIGTERM during credential migration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'major-provision-source-start-sigterm-'));
    roots.push(root);
    const limactlPath = fakeLima(root, 'major-worker-0123456789ab');
    const sha = `0123456789ab${'0'.repeat(28)}`;
    const child = spawn('bash', [provisioner, limactlPath, 'major-worker-0123456789ab', sha], {
      env: {
        ...process.env,
        MAJOR_FAKE_LIMA_STATE: join(root, 'state'),
        MAJOR_FAKE_LIMA_LOG: join(root, 'log'),
        MAJOR_FAKE_LIMA_AUTH_SOURCE: '1',
        MAJOR_FAKE_LIMA_SOURCE_STATUS: 'Stopped',
        MAJOR_FAKE_LIMA_SOURCE_START_HANGS: '1',
        MAJOR_AUTH_SOURCE_START_TIMEOUT_SECS: '60',
      },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exitPromise = new Promise<number | null>((resolvePromise) => {
      child.once('exit', (code) => resolvePromise(code));
    });
    // Give the script time to reach the hanging `start` call before signalling.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    child.kill('SIGTERM');
    const code = await exitPromise;
    expect(code).not.toBe(0);
    expect(stderr).not.toContain('previous Major worker failed to provide credentials');
    const log = readFileSync(join(root, 'log'), 'utf8');
    // The auth source (default-named "major-worker", distinct from the
    // release-specific destination) was started (attempting migration) and
    // later stopped again (restored) even though the start call itself was
    // killed mid-flight rather than completing or timing out on its own.
    expect(log).toMatch(/^start major-worker$/m);
    expect(log).toMatch(/^stop major-worker$/m);
    // No orphaned destination worker left behind by the interrupted run.
    expect(() => readFileSync(join(root, 'state'))).toThrow();
  }, 15_000);

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
