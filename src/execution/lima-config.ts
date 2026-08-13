import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const instanceName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const limaExecutionConfigSchema = z
  .object({
    backend: z.literal('lima'),
    instance: instanceName.default('major-worker'),
    limactlPath: z.string().default('/opt/homebrew/bin/limactl'),
    isolationScope: z.enum(['shared-workshop', 'project']).default('shared-workshop'),
    guestRunRoot: z
      .string()
      .regex(/^\/[A-Za-z0-9._/-]+$/)
      .default('/var/lib/major/runs'),
  })
  .strict();

export type LimaExecutionConfig = z.infer<typeof limaExecutionConfigSchema>;

export function defaultLimaExecutionConfigPath(): string {
  return join(homedir(), '.major', 'execution.json');
}

export function loadLimaExecutionConfig(
  configPath = process.env.MAJOR_EXECUTION_CONFIG ?? defaultLimaExecutionConfigPath(),
): LimaExecutionConfig {
  const parsed = JSON.parse(readFileSync(resolve(configPath), 'utf8')) as unknown;
  return limaExecutionConfigSchema.parse(parsed);
}
