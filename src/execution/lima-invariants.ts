import { z } from 'zod';

const resolvedInstanceSchema = z.object({
  name: z.string(),
  status: z.enum(['Running', 'Stopped', 'Starting', 'Stopping', 'Broken']),
  vmType: z.string(),
  arch: z.string(),
  sshAddress: z.string(),
  config: z.object({
    plain: z.boolean(),
    mounts: z.array(z.unknown()).optional(),
    portForwards: z.array(z.unknown()).optional(),
    networks: z.array(z.unknown()).optional(),
    propagateProxyEnv: z.boolean(),
    containerd: z.object({ system: z.boolean(), user: z.boolean() }),
    ssh: z.object({
      forwardAgent: z.boolean(),
      forwardX11: z.boolean(),
      forwardX11Trusted: z.boolean(),
      loadDotSSHPubKeys: z.boolean(),
    }),
    user: z.object({ name: z.string(), home: z.string() }),
  }),
});

export interface ValidatedLimaInstance {
  name: string;
  status: string;
  guestHome: string;
  guestUser: string;
}

export function validateResolvedLimaInstance(
  value: unknown,
  expectedName: string,
): ValidatedLimaInstance {
  const instance = resolvedInstanceSchema.parse(value);
  const violations: string[] = [];
  if (instance.name !== expectedName) violations.push('instance identity differs');
  if (instance.vmType !== 'vz') violations.push('vmType must be vz');
  if (instance.arch !== 'aarch64') violations.push('architecture must be aarch64');
  if (instance.sshAddress !== '127.0.0.1') violations.push('SSH must bind to host loopback');
  if (!instance.config.plain) violations.push('plain mode must be enabled');
  if ((instance.config.mounts?.length ?? 0) !== 0) violations.push('host mounts must be empty');
  if ((instance.config.portForwards?.length ?? 0) !== 0) {
    violations.push('port forwards must be empty');
  }
  if ((instance.config.networks?.length ?? 0) !== 0)
    violations.push('extra networks must be empty');
  if (instance.config.propagateProxyEnv)
    violations.push('proxy environment propagation must be off');
  if (instance.config.containerd.system || instance.config.containerd.user) {
    violations.push('containerd must be disabled');
  }
  if (
    instance.config.ssh.forwardAgent ||
    instance.config.ssh.forwardX11 ||
    instance.config.ssh.forwardX11Trusted ||
    instance.config.ssh.loadDotSSHPubKeys
  ) {
    violations.push('SSH credential and display forwarding must be disabled');
  }
  if (violations.length > 0) {
    throw new Error(
      `Lima instance ${expectedName} violates isolation policy: ${violations.join('; ')}`,
    );
  }
  return {
    name: instance.name,
    status: instance.status,
    guestHome: instance.config.user.home,
    guestUser: instance.config.user.name,
  };
}
