/**
 * Tests that must not run in the ordinary parallel pool.
 *
 * sharedResourceTestFiles may run together in one serialized Vitest process.
 * isolatedResourceTestFiles each run in their own Vitest process because they
 * mutate process-level host state that must not leak into another suite.
 */
export const sharedResourceTestFiles = [
  'tests/execution-containment.test.ts',
  'tests/lima-provisioner.test.ts',
  'tests/real-worker-containment.test.ts',
  'tests/skill-hot-sync.test.ts',
  'tests/skill-hot-sync-legacy.resource.test.ts',
  'tests/skill-resolver-evals.test.ts',
  'tests/skill-resolver-runtime.test.ts',
];

export const isolatedResourceTestFiles = ['tests/cli.test.ts', 'tests/skill-host-commands.test.ts'];

export const resourceTestFiles = [...sharedResourceTestFiles, ...isolatedResourceTestFiles];
