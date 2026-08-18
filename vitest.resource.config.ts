import { defineConfig } from 'vitest/config';

import { resourceTestFiles } from './vitest.resource-test-files.js';

export default defineConfig({
  test: {
    include: resourceTestFiles,
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
  },
});
