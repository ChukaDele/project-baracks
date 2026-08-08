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
    // Every child process must pass through an execution gateway: only the
    // legacy gateway, the Major successor gateway and the streaming spawner
    // they own may reach providers/exec or child_process.
    files: ['src/**/*.ts'],
    ignores: ['src/security/gateway.ts', 'src/security/major-gateway.ts', 'src/providers/exec.ts'],
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
              message: 'streaming spawn is gateway-internal; use an execution gateway',
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
