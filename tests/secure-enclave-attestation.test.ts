import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Runtime policy script intentionally has no TypeScript declaration.
import { validateSecureEnclaveStagedValidationLease } from '../scripts/verify-secure-enclave-staged-validation-lease.mjs';

const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-08-13T01:00:00.000Z');
type Lease = ReturnType<typeof lease>;

function lease() {
  return {
    version: 1,
    authority: 'secretive_secure_enclave',
    signingNamespace: 'major-staged-validation',
    repository: 'ChukaDele/project-baracks',
    exactCommitSha: SHA,
    sourceRef: 'refs/heads/codex/major-v051-release-candidate',
    leaseId: 'secure-enclave-12345678-1234-4234-8234-123456789abc',
    issuedAt: '2026-08-13T00:00:00.000Z',
    expiresAt: '2026-08-13T06:00:00.000Z',
    allowedScopes: [
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
    ],
    validationCases: [
      'credential-handoff',
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
    validationNonce: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
  };
}

describe('Secure Enclave staged-validation authority policy', () => {
  it('accepts only the exact current authority shape', () => {
    expect(() =>
      validateSecureEnclaveStagedValidationLease(lease(), SHA, 'provider-field', 'codex', NOW),
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
      validateSecureEnclaveStagedValidationLease(value, SHA, 'provider-field', 'codex', NOW),
    ).toThrow();
  });

  it('rejects an expired lease and a valid lease for the previous release', () => {
    expect(() =>
      validateSecureEnclaveStagedValidationLease(
        lease(),
        SHA,
        'provider-field',
        'codex',
        Date.parse('2026-08-13T07:00:00.000Z'),
      ),
    ).toThrow(/invalid/);
    expect(() =>
      validateSecureEnclaveStagedValidationLease(
        lease(),
        'b'.repeat(40),
        'provider-field',
        'codex',
        NOW,
      ),
    ).toThrow(/invalid/);
  });

  it('rejects a locally fabricated unsigned lease', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-fabricated-attestation-'));
    const leasePath = join(root, 'lease.json');
    const signaturePath = join(root, 'lease.json.sig');
    writeFileSync(leasePath, `${JSON.stringify(lease())}\n`);
    writeFileSync(signaturePath, 'not-a-signature\n');
    const result = spawnSync(
      process.execPath,
      [
        'scripts/verify-secure-enclave-staged-validation-lease.mjs',
        leasePath,
        signaturePath,
        SHA,
        'provider-field',
        'codex',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
  });

  it('requires both runtime boundaries and the pinned OpenSSH authority', () => {
    for (const path of ['src/security/major-gateway.ts', 'src/execution/lima-backend.ts']) {
      expect(String(readFileSync(path))).toContain('verifySecureEnclaveStagedValidationAuthority');
    }
    const verifier = String(
      readFileSync('scripts/verify-secure-enclave-staged-validation-lease.mjs'),
    );
    expect(verifier).toContain("'/usr/bin/ssh-keygen'");
    expect(verifier).toContain("'verify'");
    expect(verifier).toContain("'-Y'");
    expect(verifier).toContain("'/etc/major/staged-validation-allowed-signers'");
    expect(verifier).not.toContain('guidance/staged-validation-allowed-signers');
    const issuer = String(readFileSync('scripts/issue-secure-enclave-staged-validation-lease.sh'));
    expect(issuer).toContain('/etc/major/staged-validation-authority.pub');
    expect(issuer).not.toContain('guidance/staged-validation-authority.pub');
    const bootstrap = String(
      readFileSync('scripts/install-secure-enclave-staged-validation-trust.sh'),
    );
    expect(bootstrap).not.toContain('mktemp');
    expect(bootstrap).toContain('set publicLine to quoted form of item 1 of argv');
    expect(bootstrap).toContain('test ! -e /etc/major/staged-validation-authority.pub');
    expect(bootstrap).toContain('[ "$(cat "$SYSTEM_PUBLIC_KEY")" = "$PUBLIC_LINE" ]');
  });
});
