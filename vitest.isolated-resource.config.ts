import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { isolatedResourceTestFiles } from './vitest.resource-test-files.js';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '#trust-roots',
        replacement: fileURLToPath(new URL('./tests/fixtures/trust-roots.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: isolatedResourceTestFiles,
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
