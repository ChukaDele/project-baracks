import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Several integration files compile or launch the production CLI. Running
    // those files together can starve their child processes on shared hosts.
    fileParallelism: false,
  },
});
