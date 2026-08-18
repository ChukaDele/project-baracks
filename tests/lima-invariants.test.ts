import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateResolvedLimaInstance } from '../src/execution/lima-invariants.js';

function validInstance() {
  return {
    name: 'major-worker',
    status: 'Stopped',
    vmType: 'vz',
    arch: 'aarch64',
    sshAddress: '127.0.0.1',
    config: {
      plain: true,
      mounts: [] as unknown[],
      portForwards: [] as unknown[],
      networks: [] as unknown[],
      propagateProxyEnv: false,
      containerd: { system: false, user: false },
      ssh: {
        forwardAgent: false,
        forwardX11: false,
        forwardX11Trusted: false,
        loadDotSSHPubKeys: false,
      },
      user: { name: 'major', home: '/home/major.guest' },
    },
  };
}

describe('resolved Lima isolation invariants', () => {
  it('pins the Ubuntu 26.04 netplan readiness compatibility parameter', () => {
    const template = readFileSync(
      resolve(import.meta.dirname, '../templates/lima/major-worker.yaml'),
      'utf8',
    );
    expect(template).toContain('internal_netplanOptional: "true"');
  });
  it('accepts the effective isolated configuration', () => {
    expect(validateResolvedLimaInstance(validInstance(), 'major-worker')).toEqual({
      name: 'major-worker',
      status: 'Stopped',
      guestHome: '/home/major.guest',
      guestUser: 'major',
    });
  });

  it.each([
    ['plain mode', (v: ReturnType<typeof validInstance>) => (v.config.plain = false)],
    ['mount', (v: ReturnType<typeof validInstance>) => v.config.mounts.push({ location: '~' })],
    ['port forward', (v: ReturnType<typeof validInstance>) => v.config.portForwards.push({})],
    [
      'proxy propagation',
      (v: ReturnType<typeof validInstance>) => (v.config.propagateProxyEnv = true),
    ],
    [
      'agent forwarding',
      (v: ReturnType<typeof validInstance>) => (v.config.ssh.forwardAgent = true),
    ],
  ])('rejects %s drift in the effective configuration', (_name, mutate) => {
    const value = validInstance();
    mutate(value);
    expect(() => validateResolvedLimaInstance(value, 'major-worker')).toThrow(/isolation policy/);
  });
});
