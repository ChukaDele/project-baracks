#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'ChukaDele/project-baracks';
const SOURCE_REF = 'refs/heads/codex/major-v051-release-candidate';
const SIGNER = `${REPOSITORY}/.github/workflows/ci.yml`;
const ALLOWED_SCOPES = [
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
];
const VALIDATION_CASES = [
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
  'nonce',
  'validationNonce',
  'releaseWorkflow',
].sort();

export function validateGithubStagedValidationLease(
  lease,
  expectedSha,
  expectedCase,
  expectedProvider,
  now = Date.now(),
) {
  if (JSON.stringify(Object.keys(lease).sort()) !== JSON.stringify(EXACT_KEYS)) {
    throw new Error('GitHub staged-validation lease has unknown or missing fields');
  }
  const issuedAt = Date.parse(lease.issuedAt);
  const expiresAt = Date.parse(lease.expiresAt);
  const providerScope = expectedProvider ? `provider:${expectedProvider}` : undefined;
  if (
    lease.version !== 1 ||
    lease.repository !== REPOSITORY ||
    lease.exactCommitSha !== expectedSha ||
    lease.sourceRef !== SOURCE_REF ||
    !/^github-\d+-\d+$/.test(lease.leaseId) ||
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
    lease.releaseWorkflow?.path !== '.github/workflows/ci.yml' ||
    !Number.isSafeInteger(lease.releaseWorkflow?.runId) ||
    !Number.isSafeInteger(lease.releaseWorkflow?.runAttempt) ||
    lease.nonce !==
      `${lease.releaseWorkflow.runId}.${lease.releaseWorkflow.runAttempt}.${expectedSha}` ||
    lease.validationNonce !==
      expectedSha.slice(0, 8) + '-0000-4000-8000-' + expectedSha.slice(8, 20)
  ) {
    throw new Error('GitHub staged-validation lease scope or lifetime is invalid');
  }
}

function main() {
  const [leasePath, bundlePath, expectedSha, expectedCase, expectedProvider] =
    process.argv.slice(2);
  if (!leasePath || !bundlePath || !/^[0-9a-f]{40}$/.test(expectedSha ?? '') || !expectedCase) {
    throw new Error(
      'usage: verify-github-staged-validation-lease.mjs <lease> <bundle> <sha> <case> [provider]',
    );
  }
  const leaseBytes = readFileSync(realpathSync(leasePath));
  const lease = JSON.parse(leaseBytes.toString('utf8'));
  validateGithubStagedValidationLease(lease, expectedSha, expectedCase, expectedProvider);

  const ghPath = process.platform === 'darwin' ? '/opt/homebrew/bin/gh' : '/usr/bin/gh';
  const canonicalGh = realpathSync(ghPath);
  let ghFd;
  if (process.platform === 'darwin') {
    const trustedBytes = readFileSync(canonicalGh);
    const ghDigest = createHash('sha256').update(trustedBytes).digest('hex');
    if (
      canonicalGh !== '/opt/homebrew/Cellar/gh/2.95.0/bin/gh' ||
      ghDigest !== '798882434e7f6ae5846194191263ecc59d56bc201f13f016270f44cb4f34499e'
    ) {
      throw new Error('GitHub attestation verifier executable does not match the pinned release');
    }
    const privateRoot = mkdtempSync(join(tmpdir(), 'major-gh-verify.'));
    const privateGh = join(privateRoot, 'gh');
    writeFileSync(privateGh, trustedBytes, { mode: 0o500, flag: 'wx' });
    chmodSync(privateGh, 0o500);
    ghFd = openSync(privateGh, 'r');
    unlinkSync(privateGh);
    rmdirSync(privateRoot);
  }
  const args = [
    'attestation',
    'verify',
    realpathSync(leasePath),
    '--bundle',
    realpathSync(bundlePath),
    '--repo',
    REPOSITORY,
    '--signer-workflow',
    SIGNER,
    '--cert-identity',
    `https://github.com/${SIGNER}@${SOURCE_REF}`,
    '--source-digest',
    expectedSha,
    '--source-ref',
    SOURCE_REF,
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ];
  const verification =
    ghFd === undefined
      ? spawnSync(canonicalGh, args, {
          encoding: 'utf8',
          env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', GH_PROMPT_DISABLED: '1' },
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawnSync('/dev/fd/3', args, {
          encoding: 'utf8',
          env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', GH_PROMPT_DISABLED: '1' },
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe', ghFd],
        });
  if (ghFd !== undefined) closeSync(ghFd);
  if (verification.error || verification.status !== 0) {
    throw (
      verification.error ??
      new Error(`GitHub attestation verification failed: ${verification.stderr}`)
    );
  }
  const verificationOutput = verification.stdout;
  const artifactDigest = createHash('sha256').update(leaseBytes).digest('hex');
  const verified = JSON.parse(verificationOutput);
  if (
    !Array.isArray(verified) ||
    verified.length !== 1 ||
    !verified[0]?.verificationResult?.statement?.subject?.some(
      (subject) => subject?.digest?.sha256 === artifactDigest,
    )
  ) {
    throw new Error('GitHub attestation did not verify the exact lease bytes');
  }
  process.stdout.write(
    `${JSON.stringify({
      authority: 'github_actions',
      leaseId: lease.leaseId,
      sha: expectedSha,
      sourceRef: SOURCE_REF,
      caseId: expectedCase,
      provider: expectedProvider ?? null,
      expiresAt: lease.expiresAt,
      artifactDigest,
      validationNonce: lease.validationNonce,
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
