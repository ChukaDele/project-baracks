import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProviderOutcomeSignals, LimaBackend } from '../src/execution/lima-backend.js';
import { openDb } from '../src/db/client.js';
import { verifyProviderApprovalAuthority } from '../src/security/provider-approval-policy.js';
import { EXHAUSTION_PATTERN, RATE_LIMIT_PATTERN } from '../src/providers/commands.js';
import { tempDbPath } from './helpers.js';

function fakeLima(version = 'limactl version 2.2.0'): string {
  const root = mkdtempSync(join(tmpdir(), 'major-fake-lima-'));
  const path = join(root, 'limactl');
  const instance = JSON.stringify({
    name: 'major-worker',
    status: 'Stopped',
    vmType: 'vz',
    arch: 'aarch64',
    sshAddress: '127.0.0.1',
    config: {
      plain: true,
      mounts: [],
      portForwards: [],
      networks: [],
      propagateProxyEnv: false,
      containerd: { system: false, user: false },
      ssh: {
        forwardAgent: false,
        forwardX11: false,
        forwardX11Trusted: false,
        loadDotSSHPubKeys: false,
      },
      user: { name: 'major-admin', home: '/home/major-admin' },
    },
  });
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\n  --version) printf '%s\\n' '${version}' ;;\n  list) printf '%s\\n' '${instance}' ;;\n  *) exit 64 ;;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function backend(limactlPath: string): LimaBackend {
  return new LimaBackend({
    backend: 'lima',
    instance: 'major-worker',
    limactlPath,
    isolationScope: 'shared-workshop',
    guestRunRoot: '/var/lib/major/runs',
  });
}

describe('Lima backend inspection', () => {
  it('accepts only a resolved instance with every isolation invariant', async () => {
    await expect(backend(fakeLima()).inspect()).resolves.toMatchObject({
      kind: 'lima',
      available: true,
      filesystemIsolation: true,
      networkIsolation: true,
      lifecycleIsolation: true,
    });
  });

  it('fails closed when the pinned Lima version leaves the supported minor line', async () => {
    await expect(backend(fakeLima('limactl version 2.3.0')).inspect()).resolves.toMatchObject({
      available: false,
      filesystemIsolation: false,
      networkIsolation: false,
      lifecycleIsolation: false,
      detail: expect.stringMatching(/unsupported Lima version/),
    });
  });

  it('attempts real supervised execution now that core-runner safety is active (M1)', async () => {
    // live-agent-execution gates core isolated-runner safety, which is active,
    // so a supervised request is no longer synchronously refused at the
    // capability gate. execute() returns a handle immediately; the actual
    // Lima start happens asynchronously and fails here only because the fake
    // limactl in this test does not implement `start`.
    const handle = backend(fakeLima()).execute({
      executionAuthority: { kind: 'supervised' },
      executable: 'node',
      args: [],
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    });
    const outcome = await handle.outcome;
    expect(outcome.status).toBe('failed');
    expect(outcome.stderrTail ?? '').toMatch(/failed to start Lima instance|Lima/);
  });

  it('rejects a forged staged authority before any Lima operation', () => {
    const prior = process.env.MAJOR_DB_PATH;
    const dbPath = tempDbPath();
    process.env.MAJOR_DB_PATH = dbPath;
    const opened = openDb(dbPath);
    opened.sqlite.close();
    try {
      expect(() =>
        backend(fakeLima()).execute({
          executionAuthority: {
            kind: 'staged_validation',
            leaseId: 'vlease_missing',
            token: '0'.repeat(64),
            requestDigest: '1'.repeat(64),
            releaseSha: '2'.repeat(40),
            workerId: 'forged',
            processNonce: 'forged',
          },
          executable: 'codex',
          args: ['exec'],
          cwd: process.cwd(),
          allowedRoots: [process.cwd()],
          providerRequest: {
            host: 'codex',
            prompt: 'forged',
            allowGuestMutation: false,
            approvalAuthority: verifyProviderApprovalAuthority(
              'codex',
              { decisions: [] },
              () => true,
            ),
          },
        }),
      ).toThrow(/lease not found/);
    } finally {
      if (prior === undefined) delete process.env.MAJOR_DB_PATH;
      else process.env.MAJOR_DB_PATH = prior;
    }
  });

  it('rejects a forged Workshop authority before any Lima operation', () => {
    expect(() =>
      backend(fakeLima()).execute({
        executionAuthority: {
          kind: 'supervised_workshop',
          attachmentId: 'forged',
          sessionId: 'forged',
          project: 'forged',
          repoPath: process.cwd(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        executable: 'codex',
        args: ['exec'],
        cwd: process.cwd(),
        allowedRoots: [process.cwd()],
        providerRequest: {
          host: 'codex',
          prompt: 'forged',
          allowGuestMutation: false,
          approvalAuthority: verifyProviderApprovalAuthority(
            'codex',
            { decisions: [] },
            () => true,
          ),
        },
      }),
    ).toThrow(/supervised Workshop|owner-approved build|registered Git project/);
  });

  it('attempts a real provider probe now that core-runner safety is active (M1)', async () => {
    // With live-agent-execution active, probeProvider no longer short-circuits
    // to a disabled stub — it starts the real Lima instance, which fails here
    // only because the fake limactl in this test does not implement `start`.
    await expect(backend(fakeLima()).probeProvider('codex')).rejects.toThrow(
      /failed to start Lima instance/,
    );
  });
});

describe('Lima backend credential import: cross-provider path binding', () => {
  // An adversarial review found that neither this method nor the guest-side
  // broker verified the (host, path) pair actually matched — the invariant
  // held only because lifecycle-cli.ts's single call site always derives
  // both from the same map. These tests exercise the structural guard added
  // in response, entirely before any real Lima operation is attempted.
  it("refuses a path that does not match the claimed provider's known host credential location", async () => {
    const result = await backend(fakeLima()).importProviderCredential(
      'codex',
      '/tmp/definitely-not-codexs-real-credential.json',
    );
    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/does not match codex's known host credential location/),
    });
  });

  it('does not refuse on the mismatch guard when the path genuinely matches the claimed provider', async () => {
    const realCodexPath = join(homedir(), '.codex', 'auth.json');
    // The fake limactl in this suite doesn't implement `start`, so this
    // still ends in failure past the guard -- the point is which failure:
    // it must be the real Lima-start failure, not the mismatch guard,
    // proving the guard itself passed for a genuine match.
    await expect(
      backend(fakeLima()).importProviderCredential('codex', realCodexPath),
    ).rejects.toThrow(/failed to start Lima instance/);
  });
});

/**
 * A stateful fake limactl for loginProviderNative: real limactl subprocesses
 * spawned by LimaBackend go through hostEnv(), a deliberately minimal,
 * fixed environment (HOME/PATH/LANG only) -- so, unlike
 * lima-provisioner.test.ts's fake (invoked directly, bypassing that
 * restriction), THIS fake cannot be steered by env vars from the test
 * process. It steers itself instead: every behavior toggle is a file next
 * to the fake binary (found via `dirname "$0"`, always available regardless
 * of environment), which the test writes before constructing the backend.
 */
function fakeLoginLima(
  options: { loginExitCode?: number; producesCredential?: boolean } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'major-fake-login-lima-'));
  if (options.loginExitCode !== undefined) {
    writeFileSync(join(root, 'login-exit'), String(options.loginExitCode));
  }
  if (options.producesCredential) {
    writeFileSync(join(root, 'produces-credential'), '1');
  }
  const path = join(root, 'limactl');
  writeFileSync(
    path,
    `#!/bin/sh
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
STATUS_FILE="$DIR/vm-status"
case "$1" in
  --version) printf 'limactl version 2.2.0\\n' ;;
  list)
    status="$(cat "$STATUS_FILE" 2>/dev/null || echo Stopped)"
    printf '{"name":"major-worker","status":"%s","vmType":"vz","arch":"aarch64","sshAddress":"127.0.0.1","config":{"plain":true,"mounts":[],"portForwards":[],"networks":[],"propagateProxyEnv":false,"containerd":{"system":false,"user":false},"ssh":{"forwardAgent":false,"forwardX11":false,"forwardX11Trusted":false,"loadDotSSHPubKeys":false},"user":{"name":"major-admin","home":"/home/major-admin"}}}\\n' "$status"
    ;;
  start) printf Running > "$STATUS_FILE"; exit 0 ;;
  stop) printf Stopped > "$STATUS_FILE"; exit 0 ;;
  copy) exit 0 ;;
  shell)
    line="$*"
    case "$line" in
      *login\\ --device-auth*)
        printf 'Open this link in your browser and sign in to your account\\n'
        printf 'https://auth.openai.com/codex/device\\n'
        printf 'Enter this one-time code (expires in 15 minutes)\\n'
        printf 'TEST-DEVICE-CODE\\n'
        exit "$(cat "$DIR/login-exit" 2>/dev/null || echo 0)"
        ;;
      *"sudo test -f"*)
        [ -f "$DIR/produces-credential" ] && exit 0 || exit 1
        ;;
      *"import.py codex"*)
        printf 'imported codex credential -> /var/lib/major/provider-auth/codex/.codex/auth.json\\n'
        exit 0
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 64 ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe('Lima backend native login (Codex device-auth)', () => {
  it('refuses immediately for a provider with no verified native-login flow, before any Lima operation', async () => {
    const lines: string[] = [];
    const result = await backend(fakeLima()).loginProviderNative('claude', (l) => lines.push(l));
    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringMatching(
        /native login inside the isolated worker is not yet supported for claude/,
      ),
    });
    expect(lines).toEqual([]);
  });

  it('relays the device URL and code as they are printed, and reports success once the broker places the credential', async () => {
    const lines: string[] = [];
    const result = await backend(fakeLoginLima({ producesCredential: true })).loginProviderNative(
      'codex',
      (l) => lines.push(l),
    );
    expect(result).toMatchObject({ ok: true });
    expect(lines.join('\n')).toContain('https://auth.openai.com/codex/device');
    expect(lines.join('\n')).toContain('TEST-DEVICE-CODE');
  });

  it('reports a clean failure when the login process itself exits non-zero', async () => {
    const result = await backend(fakeLoginLima({ loginExitCode: 1 })).loginProviderNative(
      'codex',
      () => undefined,
    );
    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/did not complete successfully/),
    });
  });

  it('reports a clean, non-alarming failure when the login exits cleanly but no credential appears (cancelled/expired)', async () => {
    const result = await backend(fakeLoginLima({ loginExitCode: 0 })).loginProviderNative(
      'codex',
      () => undefined,
    );
    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/cancelled or the code may have expired/),
    });
  });
});

/**
 * Found by real end-to-end testing (not by design review): probeProvider
 * checked the dedicated guest user's static home for a credential, but
 * neither host-credential import nor native login ever wrote anything
 * there -- both only wrote the canonical provider-auth store, which nothing
 * read from again. A provider could be successfully imported/logged in and
 * still probe as not-authenticated forever. These tests prove the fix: a
 * sync step now runs before every probe, materializing the canonical
 * store's credential into the static home when one exists, and leaving the
 * static home untouched when the store is empty.
 */
function fakeLimaLoggingShell(): { limactlPath: string; readLog: () => string[] } {
  const root = mkdtempSync(join(tmpdir(), 'major-fake-lima-materialize-'));
  const path = join(root, 'limactl');
  writeFileSync(
    path,
    `#!/bin/sh
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/calls.log"
STATUS_FILE="$DIR/vm-status"
case "$1" in
  --version) printf 'limactl version 2.2.0\\n' ;;
  list)
    status="$(cat "$STATUS_FILE" 2>/dev/null || echo Stopped)"
    printf '{"name":"major-worker","status":"%s","vmType":"vz","arch":"aarch64","sshAddress":"127.0.0.1","config":{"plain":true,"mounts":[],"portForwards":[],"networks":[],"propagateProxyEnv":false,"containerd":{"system":false,"user":false},"ssh":{"forwardAgent":false,"forwardX11":false,"forwardX11Trusted":false,"loadDotSSHPubKeys":false},"user":{"name":"major-admin","home":"/home/major-admin"}}}\\n' "$status"
    ;;
  start) printf Running > "$STATUS_FILE"; exit 0 ;;
  stop) printf Stopped > "$STATUS_FILE"; exit 0 ;;
  copy) exit 0 ;;
  shell)
    shift
    printf '%s\\n' "$*" >> "$LOG"
    line="$*"
    case "$line" in
      *"provider-auth/codex"*"test -f"*) [ -f "$DIR/store-has-credential" ] && exit 0 || exit 1 ;;
      *"sh -c"*"provider-auth/codex"*) exit 0 ;;
      *login\\ status*)
        [ -f "$DIR/store-has-credential" ] && printf 'Logged in using ChatGPT\\n' || printf 'Not logged in\\n'
        exit 0
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 64 ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return {
    limactlPath: path,
    readLog: () => {
      try {
        return readFileSync(join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

describe('Lima backend probe: materializes the canonical credential store into the static home', () => {
  it('syncs the canonical store into the static home BEFORE probing, when a credential exists', async () => {
    const fake = fakeLimaLoggingShell();
    writeFileSync(join(dirname(fake.limactlPath), 'store-has-credential'), '1');
    const result = await backend(fake.limactlPath).probeProvider('codex');
    expect(result.authenticated).toBe(true);
    const log = fake.readLog();
    const syncIndex = log.findIndex(
      (l) => l.includes('sh -c') && l.includes('provider-auth/codex'),
    );
    const probeIndex = log.findIndex((l) => l.includes('login status'));
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(probeIndex).toBeGreaterThan(syncIndex);
  });

  it('leaves the static home untouched (reports not-authenticated) when nothing has been stored yet', async () => {
    const fake = fakeLimaLoggingShell(); // no store-has-credential file
    const result = await backend(fake.limactlPath).probeProvider('codex');
    expect(result.authenticated).toBe(false);
  });
});

/**
 * Found by real dogfooding against a genuinely usage-limited Codex account
 * (not by design review): a real dispatch exited non-zero with the account's
 * actual usage-limit message present only inside the JSON-mode stdout event
 * stream --
 *   {"type":"error","message":"You've hit your usage limit. ..."}
 * -- while stderr held only unrelated CLI boilerplate ("Reading additional
 * input from stdin..."). The exhaustion/rate-limit detectors scanned stderr
 * only, so a real, confirmed exhaustion event was silently misclassified as
 * exhausted:false. These tests use that captured real output verbatim.
 */
describe('Lima backend provider outcome classification: stdout-carried exhaustion', () => {
  const realCodexExhaustionStdout = [
    '{"type":"thread.started","thread_id":"01a00d5a-cb04-7543-a02c-7f196ab84c0a"}',
    '{"type":"turn.started"}',
    '{"type":"error","message":"You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 20th, 2026 3:32 AM."}',
    '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 20th, 2026 3:32 AM."}}',
  ].join('\n');
  const irrelevantStderr = 'Reading additional input from stdin...\n';
  const detect = {
    detectRateLimit: (text: string) => RATE_LIMIT_PATTERN.test(text),
    detectExhaustion: (text: string) => EXHAUSTION_PATTERN.test(text),
  };

  it('classifies a real Codex usage-limit event carried only on stdout as exhausted', () => {
    const result = detectProviderOutcomeSignals(
      { stdout: realCodexExhaustionStdout, stderr: irrelevantStderr },
      detect,
    );
    expect(result).toEqual({ rateLimited: false, exhausted: true });
  });

  it('still classifies a legacy stderr-only exhaustion message (no regression)', () => {
    const result = detectProviderOutcomeSignals(
      { stdout: '', stderr: 'quota exceeded for this account' },
      detect,
    );
    expect(result).toEqual({ rateLimited: false, exhausted: true });
  });

  it('reports neither signal for an unrelated failure', () => {
    const result = detectProviderOutcomeSignals(
      { stdout: '{"type":"error","message":"unexpected token"}', stderr: 'Traceback...' },
      detect,
    );
    expect(result).toEqual({ rateLimited: false, exhausted: false });
  });

  it('returns false for both when no detectors are supplied', () => {
    const result = detectProviderOutcomeSignals(
      { stdout: realCodexExhaustionStdout, stderr: '' },
      {},
    );
    expect(result).toEqual({ rateLimited: false, exhausted: false });
  });
});
