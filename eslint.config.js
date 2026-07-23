// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'drizzle/**', 'node_modules/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Every child process must pass through the execution gateway: only the
    // gateway (and the streaming spawner it owns) may touch child_process,
    // and only the gateway may reach the spawner.
    files: ['src/**/*.ts'],
    ignores: ['src/security/gateway.ts', 'src/providers/exec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:child_process', message: 'spawn only via the execution gateway' },
            { name: 'child_process', message: 'spawn only via the execution gateway' },
          ],
          patterns: [
            {
              group: ['**/providers/exec.js'],
              message: 'executeStreaming is gateway-internal; use ExecutionGateway.execute()',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
