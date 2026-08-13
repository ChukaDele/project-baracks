#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'ChukaDele/project-baracks';
const SOURCE_REF = 'refs/heads/codex/major-v051-release-candidate';
const NAMESPACE = 'major-staged-validation';
const SYSTEM_ALLOWED_SIGNERS = '/etc/major/staged-validation-allowed-signers';
const ALLOWED_SCOPES = [
  'provider:claude',
  'provider:codex',
  'provider:cursor',
  'provider:antigravity',
  'credential-handoff',
  'clean-install',
  'fresh-session',
  'project:jss',
  'project:surface-talent',
  'cross-project-isolation',
  'failure-recovery',
  'burn-in',
];
const VALIDATION_CASES = [
  'credential-handoff',
  'provider-field',
  'clean-install',
  'jss-field',
  'surface-talent-field',
  'cross-project-isolation',
  'burn-in-1',
  'burn-in-2',
  'burn-in-3',
];
const EXACT_KEYS = [
  'version',
  'authority',
  'signingNamespace',
  'repository',
  'exactCommitSha',
  'sourceRef',
  'leaseId',
  'issuedAt',
  'expiresAt',
  'allowedScopes',
  'validationCases',
  'projectRestriction',
  'maxConcurrentWorkers',
  'validationNonce',
].sort();

export function validateSecureEnclaveStagedValidationLease(
  lease,
  expectedSha,
  expectedCase,
  expectedProvider,
  now = Date.now(),
) {
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  const providerScope = expectedProvider ? `provider:${expectedProvider}` : undefined;
  if (
    JSON.stringify(Object.keys(lease).sort()) !== JSON.stringify(EXACT_KEYS) ||
    lease.version !== 1 ||
    lease.authority !== 'secretive_secure_enclave' ||
    lease.signingNamespace !== NAMESPACE ||
    lease.repository !== REPOSITORY ||
    lease.exactCommitSha !== expectedSha ||
    lease.sourceRef !== SOURCE_REF ||
    !/^secure-enclave-[a-f0-9-]{36}$/.test(lease.leaseId) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now + 5 * 60 * 1000 ||
    expiresAt <= now ||
    expiresAt - issuedAt !== 6 * 60 * 60 * 1000 ||
    JSON.stringify(lease.allowedScopes) !== JSON.stringify(ALLOWED_SCOPES) ||
    JSON.stringify(lease.validationCases) !== JSON.stringify(VALIDATION_CASES) ||
    !lease.validationCases.includes(expectedCase) ||
    (providerScope && !lease.allowedScopes.includes(providerScope)) ||
    lease.projectRestriction !== 'major-owned-or-approved-isolated-worktree' ||
    lease.maxConcurrentWorkers !== 1 ||
    lease.validationNonce !==
      expectedSha.slice(0, 8) + '-0000-4000-8000-' + expectedSha.slice(8, 20)
  )
    throw new Error('Secure Enclave staged-validation lease is invalid');
}

function main() {
  const [leasePath, signaturePath, expectedSha, expectedCase, expectedProvider] =
    process.argv.slice(2);
  if (!leasePath || !signaturePath || !/^[0-9a-f]{40}$/.test(expectedSha ?? '') || !expectedCase) {
    throw new Error(
      'usage: verify-secure-enclave-staged-validation-lease.mjs <lease> <signature> <sha> <case> [provider]',
    );
  }
  const leaseBytes = readFileSync(realpathSync(leasePath));
  const lease = JSON.parse(leaseBytes.toString('utf8'));
  validateSecureEnclaveStagedValidationLease(lease, expectedSha, expectedCase, expectedProvider);
  const anchor = lstatSync(SYSTEM_ALLOWED_SIGNERS);
  if (
    !anchor.isFile() ||
    anchor.isSymbolicLink() ||
    anchor.uid !== 0 ||
    (anchor.mode & 0o777) !== 0o444
  ) {
    throw new Error('Secure Enclave trust anchor ownership or mode is unsafe');
  }
  const verification = spawnSync(
    '/usr/bin/ssh-keygen',
    [
      '-Y',
      'verify',
      '-f',
      realpathSync(SYSTEM_ALLOWED_SIGNERS),
      '-I',
      NAMESPACE,
      '-n',
      NAMESPACE,
      '-s',
      realpathSync(signaturePath),
    ],
    {
      input: leaseBytes,
      encoding: 'utf8',
      env: {},
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (verification.error || verification.status !== 0) {
    throw (
      verification.error ??
      new Error(`Secure Enclave signature verification failed: ${verification.stderr}`)
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      authority: 'secretive_secure_enclave',
      leaseId: lease.leaseId,
      sha: expectedSha,
      sourceRef: SOURCE_REF,
      caseId: expectedCase,
      provider: expectedProvider ?? null,
      expiresAt: lease.expiresAt,
      artifactDigest: createHash('sha256').update(leaseBytes).digest('hex'),
      validationNonce: lease.validationNonce,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
