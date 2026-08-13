#!/usr/bin/env node

import { writeFileSync } from 'node:fs';

const [output] = process.argv.slice(2);
const { EXACT_SHA, SOURCE_REF, RUN_ID, RUN_ATTEMPT } = process.env;
if (
  !output ||
  !/^[0-9a-f]{40}$/.test(EXACT_SHA ?? '') ||
  SOURCE_REF !== 'refs/heads/codex/major-v051-release-candidate' ||
  !/^\d+$/.test(RUN_ID ?? '') ||
  !/^\d+$/.test(RUN_ATTEMPT ?? '')
) {
  throw new Error('canonical GitHub staged-validation context is invalid');
}

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 6 * 60 * 60 * 1000);
const lease = {
  version: 1,
  repository: 'ChukaDele/project-baracks',
  exactCommitSha: EXACT_SHA,
  sourceRef: SOURCE_REF,
  leaseId: `github-${RUN_ID}-${RUN_ATTEMPT}`,
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  allowedScopes: [
    'provider:claude',
    'provider:codex',
    'provider:cursor',
    'provider:antigravity',
    'clean-install',
    'fresh-session',
    'project:jss',
    'project:surface-talent',
    'cross-project-isolation',
    'failure-recovery',
    'burn-in',
  ],
  validationCases: [
    'provider-field',
    'clean-install',
    'jss-field',
    'surface-talent-field',
    'cross-project-isolation',
    'burn-in-1',
    'burn-in-2',
    'burn-in-3',
  ],
  projectRestriction: 'major-owned-or-approved-isolated-worktree',
  maxConcurrentWorkers: 1,
  nonce: `${RUN_ID}.${RUN_ATTEMPT}.${EXACT_SHA}`,
  validationNonce: EXACT_SHA.slice(0, 8) + '-0000-4000-8000-' + EXACT_SHA.slice(8, 20),
  releaseWorkflow: {
    path: '.github/workflows/ci.yml',
    runId: Number(RUN_ID),
    runAttempt: Number(RUN_ATTEMPT),
  },
};
writeFileSync(output, `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
