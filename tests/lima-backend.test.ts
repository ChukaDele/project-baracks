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

  it('rejects direct backend execution before starting a VM while M1 is disabled', () => {
    expect(() =>
      backend(fakeLima()).execute({
        executionAuthority: { kind: 'supervised' },
        executable: 'node',
        args: [],
        cwd: process.cwd(),
        allowedRoots: [process.cwd()],
      }),
    ).toThrow(/supervised provider execution is unavailable/);
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

  it('does not probe a provider or start Lima while M1 is disabled', async () => {
    await expect(backend(fakeLima()).probeProvider('codex')).resolves.toMatchObject({
      installed: false,
      authenticated: false,
      detail: expect.stringMatching(/disabled/),
    });
  });
});
