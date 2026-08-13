import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Runtime policy script intentionally has no TypeScript declaration.
import { validateGithubStagedValidationLease } from '../scripts/verify-github-staged-validation-lease.mjs';

const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-08-13T01:00:00.000Z');
type Lease = ReturnType<typeof lease>;

function lease() {
  return {
    version: 1,
    repository: 'ChukaDele/project-baracks',
    exactCommitSha: SHA,
    sourceRef: 'refs/heads/codex/major-v051-release-candidate',
    leaseId: 'github-123-1',
    issuedAt: '2026-08-13T00:00:00.000Z',
    expiresAt: '2026-08-13T06:00:00.000Z',
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
    nonce: `123.1.${SHA}`,
    validationNonce: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
    releaseWorkflow: { path: '.github/workflows/ci.yml', runId: 123, runAttempt: 1 },
  };
}

describe('GitHub staged-validation authority policy', () => {
  it('accepts only the exact current authority shape', () => {
    expect(() =>
      validateGithubStagedValidationLease(lease(), SHA, 'provider-field', 'codex', NOW),
    ).not.toThrow();
  });

  const mutations: Array<[string, (value: Lease) => void]> = [
    ['SHA', (value) => void (value.exactCommitSha = 'b'.repeat(40))],
    ['scope', (value) => void value.allowedScopes.push('unattended')],
    ['project', (value) => void (value.projectRestriction = 'arbitrary')],
    ['expiration', (value) => void (value.expiresAt = '2026-08-14T06:00:00.000Z')],
    ['identity', (value) => void (value.repository = 'ChukaDele/other')],
  ];

  it.each(mutations)('rejects a modified %s field', (_name, mutate) => {
    const value = lease();
    mutate(value);
    expect(() =>
      validateGithubStagedValidationLease(value, SHA, 'provider-field', 'codex', NOW),
    ).toThrow();
  });

  it('rejects an expired lease and a valid lease for the previous release', () => {
    expect(() =>
      validateGithubStagedValidationLease(
        lease(),
        SHA,
        'provider-field',
        'codex',
        Date.parse('2026-08-13T07:00:00.000Z'),
      ),
    ).toThrow(/scope or lifetime/);
    expect(() =>
      validateGithubStagedValidationLease(lease(), 'b'.repeat(40), 'provider-field', 'codex', NOW),
    ).toThrow(/scope or lifetime/);
  });

  it('rejects a locally fabricated unsigned lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-fabricated-attestation-'));
    const leasePath = join(root, 'lease.json');
    const bundlePath = join(root, 'bundle.json');
    writeFileSync(leasePath, `${JSON.stringify(lease())}\n`);
    writeFileSync(bundlePath, '{}\n');
    const result = spawnSync(
      process.execPath,
      [
        'scripts/verify-github-staged-validation-lease.mjs',
        leasePath,
        bundlePath,
        SHA,
        'provider-field',
        'codex',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
  });

  it('requires both runtime boundaries and the exact pinned GitHub workflow', () => {
    for (const path of ['src/security/major-gateway.ts', 'src/execution/lima-backend.ts']) {
      expect(String(readFileSync(path))).toContain('verifyGithubStagedValidationAuthority');
    }
    const workflow = String(readFileSync('.github/workflows/ci.yml'));
    expect(workflow).toContain('actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6');
    expect(workflow).toContain('Verify exact signed authority offline');
    const verifier = String(readFileSync('scripts/verify-github-staged-validation-lease.mjs'));
    expect(verifier).toContain('/opt/homebrew/Cellar/gh/2.95.0/bin/gh');
    expect(verifier).toContain('798882434e7f6ae5846194191263ecc59d56bc201f13f016270f44cb4f34499e');
    expect(verifier).toContain('unlinkSync(privateGh)');
    expect(verifier).toContain("spawnSync('/dev/fd/3'");
  });
});
