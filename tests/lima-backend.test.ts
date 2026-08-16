import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LimaBackend } from '../src/execution/lima-backend.js';
import { openDb } from '../src/db/client.js';
import { verifyProviderApprovalAuthority } from '../src/security/provider-approval-policy.js';
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
