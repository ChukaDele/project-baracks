#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [output, exactSha] = process.argv.slice(2);
if (!output || !/^[0-9a-f]{40}$/.test(exactSha ?? '')) {
  throw new Error('usage: create-secure-enclave-staged-validation-lease.mjs <output> <exact-sha>');
}

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + 6 * 60 * 60 * 1000);
const lease = {
  version: 1,
  authority: 'secretive_secure_enclave',
  signingNamespace: 'major-staged-validation',
  repository: 'ChukaDele/project-baracks',
  exactCommitSha: exactSha,
  sourceRef: 'refs/heads/codex/major-v051-release-candidate',
  leaseId: `secure-enclave-${randomUUID()}`,
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
  validationNonce: exactSha.slice(0, 8) + '-0000-4000-8000-' + exactSha.slice(8, 20),
};
writeFileSync(output, `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
