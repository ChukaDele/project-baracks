import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LimaBackend } from '../src/execution/lima-backend.js';

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

  it('returns a structured failure for an unsupported provider without starting a VM', async () => {
    const handle = backend(fakeLima()).execute({
      executable: 'node',
      args: [],
      cwd: process.cwd(),
      allowedRoots: [process.cwd()],
    });
    await expect(handle.outcome).resolves.toMatchObject({
      status: 'failed',
      errorKind: 'unavailable',
      cleanup: 'complete',
      exitCode: null,
    });
  });
});
