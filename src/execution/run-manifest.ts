import { existsSync, renameSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const runIdSchema = z.string().uuid();
const providerSchema = z.enum(['claude', 'codex', 'cursor', 'antigravity']);
const manifestSchema = z
  .object({
    runId: runIdSchema,
    provider: providerSchema,
    projectHash: z.string().regex(/^[a-f0-9]{64}$/),
    guestRun: z.string().startsWith('/var/lib/major/runs/'),
    state: z.enum(['preparing', 'running', 'copying_back', 'applying', 'terminal']),
    cleanup: z.enum(['pending', 'complete', 'failed']),
    result: z.enum(['succeeded', 'failed', 'timed_out', 'cancelled']).optional(),
    startedAt: z.string().datetime(),
    terminalAt: z.string().datetime().optional(),
    resourceLeaseId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = `/var/lib/major/runs/${value.provider}/${value.runId}`;
    if (value.guestRun !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['guestRun'],
        message: 'guest run path does not match provider and run identity',
      });
    }
  });

export type LimaRunManifest = z.infer<typeof manifestSchema>;

export function manifestPath(stateRoot: string, runId: string): string {
  return join(stateRoot, 'runs', runIdSchema.parse(runId), 'manifest.json');
}

export function writeRunManifest(stateRoot: string, manifest: LimaRunManifest): void {
  const value = manifestSchema.parse(manifest);
  const path = manifestPath(stateRoot, value.runId);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function readRunManifest(path: string): LimaRunManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function pendingRunManifests(stateRoot: string): LimaRunManifest[] {
  const runsRoot = join(stateRoot, 'runs');
  if (!existsSync(runsRoot)) return [];
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && runIdSchema.safeParse(entry.name).success)
    .flatMap((entry) => {
      const manifest = readRunManifest(join(runsRoot, entry.name, 'manifest.json'));
      return manifest.cleanup === 'complete' ? [] : [manifest];
    });
}
