/**
 * These tests exercise shared host resources such as macOS Seatbelt,
 * subprocess timing, and the active Lima worker. Run them after the parallel
 * suite so they cannot delay each other past their safety deadlines.
 */
export const resourceTestFiles = [
  'tests/execution-containment.test.ts',
  'tests/lima-provisioner.test.ts',
  'tests/real-worker-containment.test.ts',
  'tests/skill-hot-sync.test.ts',
  'tests/skill-hot-sync-legacy.resource.test.ts',
  'tests/skill-resolver-evals.test.ts',
  'tests/skill-resolver-runtime.test.ts',
];
