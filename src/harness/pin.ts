import { z } from 'zod';

const exactNpmVersion = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'DeepSeek Harness versions must be exact, not ranges',
  );

const npmIntegrity = z
  .string()
  .regex(
    /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    'DeepSeek Harness npm integrity must be a sha512 SRI value',
  );

const pinnedDshPackagesSchema = z
  .object({
    '@deepseek-ai/dsh': exactNpmVersion,
    '@deepseek-ai/dsh-base': exactNpmVersion,
    '@deepseek-ai/dsh-headless': exactNpmVersion,
    '@deepseek-ai/dsh-web-app': exactNpmVersion,
  })
  .strict();

const pinnedDshIntegritiesSchema = z
  .object({
    '@deepseek-ai/dsh': npmIntegrity,
    '@deepseek-ai/dsh-base': npmIntegrity,
    '@deepseek-ai/dsh-headless': npmIntegrity,
    '@deepseek-ai/dsh-web-app': npmIntegrity,
  })
  .strict();

export const deepSeekHarnessPinSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstream: z
      .object({
        name: z.literal('DeepSeek Harness'),
        organization: z.literal('deepseek-ai'),
        repository: z.literal('https://github.com/deepseek-ai/deepseek-harness'),
        license: z.literal('MIT'),
        status: z.literal('developer-preview'),
      })
      .strict(),
    npm: z
      .object({
        scope: z.literal('@deepseek-ai'),
        version: exactNpmVersion,
        packages: pinnedDshPackagesSchema,
        integrities: pinnedDshIntegritiesSchema,
        pinPolicy: z.literal('exact-version'),
        forbiddenResolutions: z.array(z.enum(['latest', 'next', '*', '^', '~', '>'])),
      })
      .strict(),
    git: z
      .object({
        declaredTag: z.string().min(1),
        lastCitedVersion: exactNpmVersion,
        lastCitedShortSha: z.string().regex(/^[0-9a-f]{7,40}$/),
        attestedCommit: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .nullable(),
        commitPolicy: z.literal('attest-before-cutover'),
      })
      .strict(),
    releasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .superRefine((pin, ctx) => {
    for (const [name, version] of Object.entries(pin.npm.packages)) {
      if (version !== pin.npm.version) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must match the distribution pin ${pin.npm.version}`,
        });
      }
    }
  });

export type DeepSeekHarnessPin = z.infer<typeof deepSeekHarnessPinSchema>;

/** Exact DeepSeek Harness versions this Major distribution wraps. Not a live install. */
export const DEEPSEEK_HARNESS_PIN: DeepSeekHarnessPin = deepSeekHarnessPinSchema.parse({
  schemaVersion: 1,
  upstream: {
    name: 'DeepSeek Harness',
    organization: 'deepseek-ai',
    repository: 'https://github.com/deepseek-ai/deepseek-harness',
    license: 'MIT',
    status: 'developer-preview',
  },
  npm: {
    scope: '@deepseek-ai',
    version: '0.1.0-rc.8',
    packages: {
      '@deepseek-ai/dsh': '0.1.0-rc.8',
      '@deepseek-ai/dsh-base': '0.1.0-rc.8',
      '@deepseek-ai/dsh-headless': '0.1.0-rc.8',
      '@deepseek-ai/dsh-web-app': '0.1.0-rc.8',
    },
    integrities: {
      '@deepseek-ai/dsh':
        'sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==',
      '@deepseek-ai/dsh-base':
        'sha512-aMjXT6d5t8SGQg24geOSX6O0ky+hJLijhzZklDcICrBvGSKXvuS8jxLOcL5u4s4pFCODXhuOpvTfFuUhN2RK3Q==',
      '@deepseek-ai/dsh-headless':
        'sha512-SfjPjyLeno7iScndgFI3s9s8focqXADLNgIxkFbsL0BdAY7v3A6TOe+iSxnYX0fMhDqFC1jT3FVYlEzbJBg0Kg==',
      '@deepseek-ai/dsh-web-app':
        'sha512-Te/N+AxFmQF2267yMqama5Lp2evsBJeFsqhnEZPfvFhquLBBWgtO5DNZ2cxto5NhGGNNCk/JV25vHRxd7bZl8g==',
    },
    pinPolicy: 'exact-version',
    forbiddenResolutions: ['latest', 'next', '*', '^', '~', '>'],
  },
  git: {
    declaredTag: 'dsh-v0.1.0-rc.8',
    lastCitedVersion: '0.1.0-rc.8',
    lastCitedShortSha: '141eb6f',
    attestedCommit: '141eb6fef83422698aef7a981029e843e8161534',
    commitPolicy: 'attest-before-cutover',
  },
  releasedAt: '2026-08-19',
});

export const HARNESS_PIN_RELATIVE_PATH = 'distribution/deepseek-harness/pin.json';
