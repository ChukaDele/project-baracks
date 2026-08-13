import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProviderCommandHost } from '../providers/commands.js';
import type { StagedValidationCase } from './staged-validation.js';

export interface VerifiedSecureEnclaveAuthority {
  authority: 'secretive_secure_enclave';
  leaseId: string;
  sha: string;
  sourceRef: string;
  caseId: StagedValidationCase;
  provider: ProviderCommandHost;
  expiresAt: string;
  artifactDigest: string;
  validationNonce: string;
}

/** The only adapter from Major to standard OpenSSH signature verification. */
export function verifySecureEnclaveStagedValidationAuthority(input: {
  releaseSha: string;
  caseId: StagedValidationCase;
  provider: ProviderCommandHost;
}): VerifiedSecureEnclaveAuthority {
  if (!/^[0-9a-f]{40}$/.test(input.releaseSha))
    throw new Error('Secure Enclave release SHA is invalid');
  const majorHome = process.env.MAJOR_HOME
    ? realpathSync(process.env.MAJOR_HOME)
    : join(homedir(), '.major');
  const authorityRoot = join(majorHome, 'staged-validation', 'authorities', input.releaseSha);
  const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
  const output = execFileSync(
    process.execPath,
    [
      join(executingRoot, 'scripts', 'verify-secure-enclave-staged-validation-lease.mjs'),
      join(authorityRoot, 'major-staged-validation-lease.json'),
      join(authorityRoot, 'major-staged-validation-lease.json.sig'),
      input.releaseSha,
      input.caseId,
      input.provider,
    ],
    {
      encoding: 'utf8',
      env: { HOME: homedir(), PATH: '/usr/bin:/bin' },
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const receipt = JSON.parse(output) as VerifiedSecureEnclaveAuthority;
  if (
    receipt.authority !== 'secretive_secure_enclave' ||
    receipt.sha !== input.releaseSha ||
    receipt.caseId !== input.caseId ||
    receipt.provider !== input.provider ||
    !/^secure-enclave-[a-f0-9-]{36}$/.test(receipt.leaseId) ||
    !/^[0-9a-f]{64}$/.test(receipt.artifactDigest) ||
    !/^[a-f0-9-]{36}$/.test(receipt.validationNonce) ||
    Date.parse(receipt.expiresAt) <= Date.now()
  )
    throw new Error('Secure Enclave verification receipt is invalid');
  return receipt;
}
