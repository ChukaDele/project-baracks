import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { resourceTestFiles } from './vitest.resource-test-files.js';

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
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: resourceTestFiles,
    environment: 'node',
  },
});
