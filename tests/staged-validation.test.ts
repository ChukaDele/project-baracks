import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const verifySecureEnclaveAuthority = vi.hoisted(() => vi.fn());
vi.mock('../src/security/secure-enclave-attestation.js', () => ({
  verifySecureEnclaveStagedValidationAuthority: verifySecureEnclaveAuthority,
}));
// Staged validation is architecturally a PRE-ACTIVATION bridge: once
// live-agent-execution (core isolated-runner safety) is active,
// issueStagedValidationLease refuses by design (see the dedicated
// retirement test below). This suite exercises the lease-fencing mechanics
// themselves (forged tokens, wrong scope, expiry, cancellation) as a
// permanent regression suite, independent of this build's real activation
// state, by holding the capability at its pre-activation value here only.
vi.mock('../src/security/capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/security/capabilities.js')>();
  const isCapabilityAvailable = (capability: string) =>
    capability === 'live-agent-execution'
      ? false
      : actual.isCapabilityAvailable(capability as never);
  return {
    ...actual,
    isCapabilityAvailable,
    // Reimplemented against the override above: assertCapabilityAvailable's
    // real body closes over the real module's own isCapabilityAvailable, so
    // spreading actual.assertCapabilityAvailable here would silently ignore
    // this mock.
    assertCapabilityAvailable: (capability: string) => {
      if (!isCapabilityAvailable(capability)) {
        throw new actual.CapabilityUnavailableError(capability as never);
      }
    },
  };
});
import { validationLeases } from '../src/db/schema.js';
import {
  admitStagedValidationLease,
  assertStagedValidationCaseRequest,
  assertStagedValidationScope,
  consumeStagedValidationExecution,
  completeStagedCliProviderField,
  completeStagedCursorField,
  currentActivationState,
  fixedStagedValidationCase,
  getStagedValidationLease,
  issueStagedValidationLease,
  recoverStaleValidationLeases,
  settleStagedValidationLease,
  stagedValidationEventsDigest,
  stagedValidationWorkspaceDigest,
  stagedValidationRequestDigest,
} from '../src/security/staged-validation.js';
import { testDb } from './helpers.js';

const hex = (value: string) => createHash('sha256').update(value).digest('hex');

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'major-staged-validation-'));
  mkdirSync(join(root, 'project'));
  return join(root, 'project');
}

function request(cwd = workspace()) {
  return {
    executable: 'codex',
    args: ['exec', '--json', 'validate'],
    cwd,
    providerRequest: {
      host: 'codex' as const,
      prompt: 'Return the fixed validation nonce.',
      allowGuestMutation: false,
      approvalAuthority: { decisions: [] },
    },
  };
}

function issue(db: ReturnType<typeof testDb>, overrides: Record<string, unknown> = {}) {
  const shaped = request();
  const secret = issueStagedValidationLease(db, {
    releaseRepository: '/release/project-baracks',
    releaseSourceCheckout: workspace(),
    releaseRoot: realpathSync(process.cwd()),
    releaseBranch: 'codex/release',
    releaseSha: 'a'.repeat(40),
    releaseTreeHash: hex('tree'),
    releaseManifestHash: hex('manifest'),
    provider: 'codex',
    projectIdentityHash: hex('github.com/chukadele/test'),
    projectRootHash: hex(realpathSync(shaped.cwd)),
    caseId: 'provider-field',
    requestDigest: stagedValidationRequestDigest(shaped),
    expectedEvidenceHash: hex('fixed-output-contract'),
    expectedExecutionStatus: 'succeeded',
    validationNonce: '11111111-1111-4111-8111-111111111111',
    workerId: 'release-validator',
    processNonce: 'process-1',
    resourceLeaseId: 'lease_worker',
    ...overrides,
  });
  const persisted = getStagedValidationLease(db, secret.leaseId);
  return {
    shaped,
    authority: {
      kind: 'staged_validation' as const,
      leaseId: secret.leaseId,
      token: secret.token,
      requestDigest: persisted.requestDigest,
      releaseSha: 'a'.repeat(40),
      workerId: 'release-validator',
      processNonce: 'process-1',
    },
  };
}

describe('staged validation state and fencing', () => {
  beforeEach(() => {
    verifySecureEnclaveAuthority.mockImplementation(
      ({ releaseSha, caseId, provider }: Record<string, string>) => ({
        authority: 'secretive_secure_enclave',
        leaseId: 'secure-enclave-12345678-1234-4234-8234-123456789abc',
        sha: releaseSha,
        sourceRef: 'refs/heads/main',
        caseId,
        provider,
        expiresAt: '2099-01-01T00:00:00.000Z',
        artifactDigest: 'f'.repeat(64),
        validationNonce: '11111111-1111-4111-8111-111111111111',
      }),
    );
  });

  it('derives every post-merge field from fixed product-owned contracts', () => {
    const nonce = '11111111-1111-4111-8111-111111111111';
    const jss = fixedStagedValidationCase('jss-field', nonce);
    expect(jss).toMatchObject({ host: 'claude', allowGuestMutation: true });
    expect(jss.prompt).toContain('internal JSS P0');
    expect(jss.prompt).toContain(jss.token);
    for (const caseId of [
      'surface-talent-field',
      'cross-project-isolation',
      'failure-recovery',
      'burn-in-1',
      'burn-in-2',
      'burn-in-3',
    ] as const) {
      const definition = fixedStagedValidationCase(caseId, nonce);
      expect(definition).toMatchObject({ host: 'codex', allowGuestMutation: false });
      expect(definition.prompt).toContain(definition.token);
    }
    expect(fixedStagedValidationCase('failure-recovery', nonce, 'failure')).toMatchObject({
      host: 'cursor',
      workspaceKind: 'failure-recovery',
      allowGuestMutation: false,
    });
  });

  it('hashes nested project workspaces while excluding Git and dependencies', () => {
    const root = workspace();
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, '.git', 'config'), 'ignored');
    writeFileSync(join(root, 'node_modules', 'package.js'), 'ignored');
    writeFileSync(join(root, 'src', 'operator.ts'), 'first');
    const first = stagedValidationWorkspaceDigest(root);
    writeFileSync(join(root, '.git', 'config'), 'changed but ignored');
    writeFileSync(join(root, 'node_modules', 'package.js'), 'changed but ignored');
    expect(stagedValidationWorkspaceDigest(root)).toBe(first);
    writeFileSync(join(root, 'src', 'operator.ts'), 'second');
    expect(stagedValidationWorkspaceDigest(root)).not.toBe(first);
  });

  it('hashes safe project-local symlinks and rejects escaping links', () => {
    const root = workspace();
    mkdirSync(join(root, '.agents'));
    mkdirSync(join(root, '.agents', 'skill'));
    mkdirSync(join(root, '.claude'));
    symlinkSync('../.agents/skill', join(root, '.claude', 'skill'));
    expect(stagedValidationWorkspaceDigest(root)).toMatch(/^[a-f0-9]{64}$/);
    symlinkSync('/tmp', join(root, '.claude', 'escape'));
    expect(() => stagedValidationWorkspaceDigest(root)).toThrow(/escaping symlink/);
  });

  it('cannot issue a local validation lease without the independent Secure Enclave authority', () => {
    verifySecureEnclaveAuthority.mockImplementationOnce(() => {
      throw new Error('signature verification failed');
    });
    expect(() => issue(testDb())).toThrow(/signature verification failed/);
  });

  it('admits one exact request, consumes it once at the backend, and reverts on success', () => {
    const db = testDb();
    const nonce = '11111111-1111-1111-1111-111111111111';
    const { shaped, authority } = issue(db, {
      expectedEvidenceHash: hex(`codex:MAJOR_CODEX_FIELD_${nonce}:cleanup-complete`),
    });
    expect(currentActivationState(db)).toBe('staged_validation');
    const admitted = admitStagedValidationLease(db, authority);
    expect(admitted.status).toBe('admitted');
    expect(() => admitStagedValidationLease(db, authority)).toThrow(/consumed/);
    expect(
      consumeStagedValidationExecution(db, authority, stagedValidationRequestDigest(shaped)).status,
    ).toBe('running');
    expect(() =>
      consumeStagedValidationExecution(db, authority, stagedValidationRequestDigest(shaped)),
    ).toThrow(/failed backend verification/);
    const awaitingEvidence = settleStagedValidationLease(db, {
      authority,
      status: 'validating',
      runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outcomeReason: 'fixed contract passed; cleanup=complete',
      evidenceHash: hex('execution evidence'),
      resultSessionRefHash: hex('session-1'),
      resultEventHash: stagedValidationEventsDigest([
        { type: 'provider-result', data: `MAJOR_CODEX_FIELD_${nonce}` },
      ]),
      resultEventCount: 1,
      resultWorkspaceHash: stagedValidationWorkspaceDigest(shaped.cwd),
    });
    expect(awaitingEvidence.status).toBe('validating');
    expect(() =>
      settleStagedValidationLease(db, {
        authority,
        status: 'validating',
        runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        outcomeReason: 'fabricated overwrite',
        evidenceHash: hex('fabricated'),
        resultEventHash: hex('fabricated events'),
        resultEventCount: 1,
        resultWorkspaceHash: hex('fabricated workspace'),
      }),
    ).toThrow(/not live/);
    expect(() =>
      db
        .update(validationLeases)
        .set({ resultEventHash: hex('fabricated events') })
        .run(),
    ).toThrow(/attestation is immutable/);
    const unsafeEvidence = JSON.stringify({ status: 'PASS', pii: 'project-local-value' });
    expect(() =>
      db
        .update(validationLeases)
        .set({
          status: 'succeeded',
          terminalAt: new Date().toISOString(),
          evidenceJson: unsafeEvidence,
          evidenceHash: hex(unsafeEvidence),
        })
        .run(),
    ).toThrow();
    const minimalEvidence = JSON.stringify({
      cleanup: 'complete',
      eventCount: 1,
      gate: 'provider-field',
      provider: 'codex',
      status: 'PASS',
    });
    expect(() =>
      db
        .update(validationLeases)
        .set({
          status: 'succeeded',
          terminalAt: new Date().toISOString(),
          evidenceJson: minimalEvidence,
          evidenceHash: hex(minimalEvidence),
        })
        .run(),
    ).toThrow();
    expect(() =>
      completeStagedCliProviderField(db, authority, {
        provider: 'codex',
        workspace: shaped.cwd,
        nonce,
        events: [
          { type: 'provider-result', data: `MAJOR_CODEX_FIELD_${nonce}` },
          { type: 'fabricated', data: `MAJOR_CODEX_FIELD_${nonce}` },
        ],
        outcome: {
          status: 'succeeded',
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          cleanup: 'complete',
          exitCode: 0,
          sessionRef: 'session-1',
          modelSelection: 'supported',
          rateLimited: false,
          exhausted: false,
        },
      }),
    ).toThrow(/event-count/);
    const terminal = completeStagedCliProviderField(db, authority, {
      provider: 'codex',
      workspace: shaped.cwd,
      nonce,
      events: [{ type: 'provider-result', data: `MAJOR_CODEX_FIELD_${nonce}` }],
      outcome: {
        status: 'succeeded',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cleanup: 'complete',
        exitCode: 0,
        sessionRef: 'session-1',
        modelSelection: 'supported',
        rateLimited: false,
        exhausted: false,
      },
    });
    expect(terminal.status).toBe('succeeded');
    expect(currentActivationState(db)).toBe('disabled');
    expect(() =>
      issueStagedValidationLease(db, {
        releaseRepository: terminal.releaseRepository,
        releaseSourceCheckout: terminal.releaseSourceCheckout,
        releaseRoot: terminal.releaseRoot,
        releaseBranch: terminal.releaseBranch,
        releaseSha: terminal.releaseSha,
        releaseTreeHash: terminal.releaseTreeHash,
        releaseManifestHash: terminal.releaseManifestHash,
        provider: 'codex',
        projectIdentityHash: terminal.projectIdentityHash,
        projectRootHash: terminal.projectRootHash,
        caseId: 'provider-field',
        requestDigest: terminal.requestDigest,
        expectedEvidenceHash: terminal.expectedEvidenceHash,
        expectedExecutionStatus: 'succeeded',
        validationNonce: terminal.authorityValidationNonce,
        workerId: 'replay-worker',
        processNonce: 'replay-process',
        resourceLeaseId: 'replay-resource',
      }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      completeStagedCliProviderField(db, authority, {
        provider: 'codex',
        workspace: shaped.cwd,
        nonce,
        events: [],
        outcome: {
          status: 'succeeded',
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          cleanup: 'complete',
          exitCode: 0,
          sessionRef: 'session-1',
          modelSelection: 'supported',
          rateLimited: false,
          exhausted: false,
        },
      }),
    ).toThrow(/does not match the durable run/);
  });

  it('rejects the wrong token, SHA, request, provider-shaped prompt, and approval authority', () => {
    const db = testDb();
    const { shaped, authority } = issue(db);
    expect(() => admitStagedValidationLease(db, { ...authority, token: '0'.repeat(64) })).toThrow(
      /token is invalid/,
    );
    expect(() =>
      admitStagedValidationLease(db, { ...authority, releaseSha: 'b'.repeat(40) }),
    ).toThrow(/does not match/);
    admitStagedValidationLease(db, authority);
    const wrongPrompt = {
      ...shaped,
      providerRequest: { ...shaped.providerRequest, prompt: 'Do a normal task instead.' },
    };
    expect(() =>
      consumeStagedValidationExecution(db, authority, stagedValidationRequestDigest(wrongPrompt)),
    ).toThrow(/failed backend verification/);
    const fabricatedApproval = {
      ...shaped,
      providerRequest: {
        ...shaped.providerRequest,
        approvalAuthority: {
          decisions: [
            {
              category: 'command_execution' as const,
              decisionId: 'dreq_fake',
              actionDigest: hex('x'),
            },
          ],
        },
      },
    };
    expect(stagedValidationRequestDigest(fabricatedApproval)).not.toBe(authority.requestDigest);
    expect(() =>
      assertStagedValidationCaseRequest(
        db,
        getStagedValidationLease(db, authority.leaseId),
        shaped,
      ),
    ).toThrow(/workspace is not product-owned/);
  });

  it('rejects wrong provider, project identity, worktree root, request, and resource lease scopes', () => {
    const db = testDb();
    const { authority } = issue(db);
    const lease = getStagedValidationLease(db, authority.leaseId);
    const valid = {
      provider: 'codex' as const,
      projectIdentityHash: lease.projectIdentityHash,
      projectRootHash: lease.projectRootHash,
      requestDigest: lease.requestDigest,
      resourceLeaseId: lease.resourceLeaseId!,
    };
    expect(() => assertStagedValidationScope(lease, valid)).not.toThrow();
    for (const invalid of [
      { ...valid, provider: 'claude' as const },
      { ...valid, projectIdentityHash: hex('other project') },
      { ...valid, projectRootHash: hex('other worktree') },
      { ...valid, requestDigest: hex('other request') },
      { ...valid, resourceLeaseId: 'lease_other' },
    ]) {
      expect(() => assertStagedValidationScope(lease, invalid)).toThrow(/scope does not match/);
    }
  });

  it('permits only one temporary staged activation and expires safely after restart', () => {
    const db = testDb();
    const now = new Date(Date.now() + 60_000);
    issue(db, { now: () => now, leaseMs: 1_000 });
    expect(() => issue(db, { now: () => now })).toThrow(/UNIQUE constraint failed/);
    expect(recoverStaleValidationLeases(db, () => new Date(now.getTime() + 1_001))).toBe(1);
    expect(currentActivationState(db)).toBe('disabled');
    expect(db.select().from(validationLeases).all()).toHaveLength(1);
    expect(db.select().from(validationLeases).get()?.status).toBe('expired');
    expect(() => db.delete(validationLeases).run()).toThrow(/append-only/);

    const second = issue(db, {
      now: () => new Date(now.getTime() + 2_000),
      leaseMs: 1_000,
    });
    admitStagedValidationLease(db, second.authority, () => new Date(now.getTime() + 2_001));
    expect(currentActivationState(db)).toBe('staged_validation');
    expect(recoverStaleValidationLeases(db, () => new Date(now.getTime() + 3_001))).toBe(1);
    expect(currentActivationState(db)).toBe('disabled');
  });

  it('reverts after a validation failure without enabling normal execution', () => {
    const db = testDb();
    const { authority } = issue(db);
    admitStagedValidationLease(db, authority);
    consumeStagedValidationExecution(db, authority, authority.requestDigest);
    const terminal = settleStagedValidationLease(db, {
      authority,
      status: 'failed',
      outcomeReason: 'provider failed; cleanup=complete',
      evidenceHash: hex('failure evidence'),
    });
    expect(terminal.status).toBe('failed');
    expect(currentActivationState(db)).toBe('disabled');
  });

  it('requires a matching contained failure before issuing recovery', () => {
    const naturalDb = testDb();
    const natural = issue(naturalDb, {
      caseId: 'failure-recovery',
      provider: 'cursor',
      projectRootHash: hex('natural failure worktree'),
      requestDigest: hex('natural failure request'),
    });
    admitStagedValidationLease(naturalDb, natural.authority);
    consumeStagedValidationExecution(naturalDb, natural.authority, natural.authority.requestDigest);
    settleStagedValidationLease(naturalDb, {
      authority: natural.authority,
      status: 'failed',
      outcomeReason: 'failed; errorKind=provider_failed; cleanup=complete',
      evidenceHash: hex('natural failure'),
    });
    expect(() =>
      issue(naturalDb, {
        caseId: 'failure-recovery',
        provider: 'codex',
        projectRootHash: hex('natural failure worktree'),
        requestDigest: hex('invalid recovery request'),
        predecessorLeaseId: natural.authority.leaseId,
      }),
    ).toThrow(/not a matching contained failure/);

    const db = testDb();
    const rootHash = hex('same recovery worktree');
    expect(() =>
      issue(db, {
        caseId: 'failure-recovery',
        provider: 'codex',
        projectRootHash: rootHash,
      }),
    ).toThrow(/recovery requires its failed validation predecessor/);

    const failed = issue(db, {
      caseId: 'failure-recovery',
      provider: 'cursor',
      projectRootHash: rootHash,
      requestDigest: hex('forced failure request'),
    });
    admitStagedValidationLease(db, failed.authority);
    consumeStagedValidationExecution(db, failed.authority, failed.authority.requestDigest);
    settleStagedValidationLease(db, {
      authority: failed.authority,
      status: 'failed',
      outcomeReason: 'failed; errorKind=interrupted; cleanup=complete',
      evidenceHash: hex('contained failure'),
    });
    expect(() =>
      issue(db, {
        caseId: 'failure-recovery',
        provider: 'codex',
        projectRootHash: rootHash,
        requestDigest: hex('recovery request'),
        predecessorLeaseId: failed.authority.leaseId,
      }),
    ).not.toThrow();
  });

  it('records cancellation truthfully even when the outcome settles just after expiry', () => {
    const db = testDb();
    const now = new Date(Date.now() + 60_000);
    const { authority } = issue(db, {
      now: () => now,
      leaseMs: 1_000,
      expectedExecutionStatus: 'cancelled',
    });
    admitStagedValidationLease(db, authority, () => new Date(now.getTime() + 1));
    consumeStagedValidationExecution(
      db,
      authority,
      authority.requestDigest,
      () => new Date(now.getTime() + 2),
    );
    const terminal = settleStagedValidationLease(db, {
      authority,
      status: 'cancelled',
      outcomeReason: 'timed_out; cleanup=complete',
      evidenceHash: hex('timeout evidence'),
      now: () => new Date(now.getTime() + 1_001),
    });
    expect(terminal.status).toBe('cancelled');
    expect(currentActivationState(db)).toBe('disabled');
  });

  it('accepts a clean Cursor cancellation before model selection completes', () => {
    const db = testDb();
    const nonce = '11111111-1111-4111-8111-111111111111';
    const cancelled = issue(db, {
      provider: 'cursor',
      expectedEvidenceHash: hex(`cursor:cancel:${nonce}:cleanup-complete`),
      expectedExecutionStatus: 'cancelled',
    });
    const events = [{ type: 'acp-session-update', data: { available_commands_update: {} } }];
    admitStagedValidationLease(db, cancelled.authority);
    consumeStagedValidationExecution(db, cancelled.authority, cancelled.authority.requestDigest);
    settleStagedValidationLease(db, {
      authority: cancelled.authority,
      status: 'validating',
      outcomeReason: 'cancelled; cleanup=complete',
      evidenceHash: hex('runtime cancellation evidence'),
      runId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      resultEventHash: stagedValidationEventsDigest(events),
      resultEventCount: events.length,
      resultWorkspaceHash: stagedValidationWorkspaceDigest(cancelled.shaped.cwd),
    });

    const terminal = completeStagedCursorField(db, cancelled.authority, {
      phase: 'cancel',
      workspace: cancelled.shaped.cwd,
      nonce,
      events,
      outcome: {
        status: 'cancelled',
        runId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        cleanup: 'complete',
        exitCode: null,
        rateLimited: false,
        exhausted: false,
      },
    });

    expect(terminal.status).toBe('succeeded');
    expect(currentActivationState(db)).toBe('disabled');
  });

  it('binds Cursor resume issuance to one successful create lease for the same release and worktree', () => {
    const db = testDb();
    const nonce = '22222222-2222-2222-2222-222222222222';
    const created = issue(db, {
      provider: 'cursor',
      expectedEvidenceHash: hex(`cursor:create:${nonce}:cleanup-complete`),
    });
    writeFileSync(
      join(created.shaped.cwd, 'CURSOR_ACP_FIELD.txt'),
      `MAJOR_CURSOR_ACP_FIELD_${nonce}\n`,
    );
    admitStagedValidationLease(db, created.authority);
    consumeStagedValidationExecution(db, created.authority, created.authority.requestDigest);
    settleStagedValidationLease(db, {
      authority: created.authority,
      status: 'validating',
      outcomeReason: 'cursor create completed',
      evidenceHash: hex('runtime evidence'),
      runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      resultSessionRefHash: hex('session-1'),
      resultModel: 'cursor/model-1',
      resultEventHash: stagedValidationEventsDigest([
        { type: 'acp-session-update', data: { available_commands_update: {} } },
      ]),
      resultEventCount: 1,
      resultWorkspaceHash: stagedValidationWorkspaceDigest(created.shaped.cwd),
    });
    expect(() =>
      completeStagedCursorField(db, created.authority, {
        phase: 'create',
        workspace: created.shaped.cwd,
        nonce,
        events: [{ type: 'acp-session-update', data: { available_commands_update: {} } }],
        outcome: {
          status: 'succeeded',
          runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          cleanup: 'complete',
          exitCode: 0,
          sessionRef: 'session-1',
          actualModel: 'cursor/model-1',
          modelSelection: 'unsupported',
          rateLimited: false,
          exhausted: false,
        },
      }),
    ).toThrow(/fixed field case/);
    completeStagedCursorField(db, created.authority, {
      phase: 'create',
      workspace: created.shaped.cwd,
      nonce,
      events: [{ type: 'acp-session-update', data: { available_commands_update: {} } }],
      outcome: {
        status: 'succeeded',
        runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        cleanup: 'complete',
        exitCode: 0,
        sessionRef: 'session-1',
        actualModel: 'cursor/model-1',
        modelSelection: 'supported',
        rateLimited: false,
        exhausted: false,
      },
    });
    const predecessor = getStagedValidationLease(db, created.authority.leaseId);
    expect(() =>
      issue(db, {
        provider: 'cursor',
        predecessorLeaseId: predecessor.id,
        projectIdentityHash: predecessor.projectIdentityHash,
        projectRootHash: hex('wrong worktree'),
      }),
    ).toThrow(/not a matching validated create/);
    expect(() =>
      issue(db, {
        provider: 'cursor',
        predecessorLeaseId: predecessor.id,
        projectIdentityHash: predecessor.projectIdentityHash,
        projectRootHash: predecessor.projectRootHash,
      }),
    ).not.toThrow();
  });

  it('keeps the immutable default disabled and never exposes unattended', () => {
    const db = testDb();
    expect(currentActivationState(db)).toBe('disabled');
    expect(currentActivationState(db)).not.toBe('unattended');
  });

  it('routes shipped provider fields through staged support rather than direct LimaBackend access', async () => {
    for (const script of [
      'scripts/validate-cli-provider-field.mjs',
      'scripts/validate-cursor-acp-field.mjs',
    ]) {
      const source = readFileSync(script, 'utf8');
      expect(source).toMatch(/executeStaged(?:CliProvider|Cursor)Field/);
      expect(source).not.toContain('LimaBackend');
    }
    const support = readFileSync('scripts/staged-field-support.mjs', 'utf8');
    expect(support).not.toContain('export function executeStagedFieldCase');
    expect(support).toContain("join(homedir(), '.major')");
    expect(support).toContain('refuses non-canonical');
    for (const boundary of ['src/security/major-gateway.ts', 'src/execution/lima-backend.ts']) {
      expect(readFileSync(boundary, 'utf8')).toContain('assertStagedValidationCaseRequest');
      expect(readFileSync(boundary, 'utf8')).toContain('verify-major-staged-candidate.sh');
    }
    const gateway = readFileSync('src/security/major-gateway.ts', 'utf8');
    expect(gateway.indexOf('await eventPump')).toBeLessThan(
      gateway.indexOf('settleStagedValidationLease(opened.db'),
    );
    const staged = readFileSync('src/security/staged-validation.ts', 'utf8');
    expect(staged).toContain('nonce !== lease.authorityValidationNonce');
    expect(staged).toContain(
      "input.phase !== 'cancel' && input.outcome.modelSelection !== 'supported'",
    );
    expect(staged).toContain('input.outcome.requestedModel !== input.expectedModel');
    const cursorField = readFileSync('scripts/validate-cursor-acp-field.mjs', 'utf8');
    expect(cursorField).toContain('validationLeaseId: handle.validationLeaseId');
    expect(cursorField).toContain('predecessorLeaseId: created.validationLeaseId');
    const helperPath = '../scripts/cursor-field-runner.mjs';
    const { executeCursorFieldPhase } = await import(helperPath);
    let observed: Record<string, unknown> | undefined;
    executeCursorFieldPhase(
      (input: Record<string, unknown>) => {
        observed = input;
        return input;
      },
      {
        phase: 'resume',
        nonce: '00000000-0000-4000-8000-000000000000',
        resumeSessionRef: 'cursor-session',
        modelRef: 'cursor/model',
        predecessorLeaseId: 'lease-created',
      },
    );
    expect(observed).toMatchObject({
      phase: 'resume',
      predecessorLeaseId: 'lease-created',
      resumeSessionRef: 'cursor-session',
      modelRef: 'cursor/model',
    });
  });

  it('keeps staged candidate verification independent of the interactive pnpm path', () => {
    expect(readFileSync('scripts/verify-major-staged-candidate.sh', 'utf8')).toContain(
      'corepack pnpm --dir "$SOURCE_ROOT" build',
    );
    expect(readFileSync('scripts/build-major-runtime-snapshot.sh', 'utf8')).toContain(
      'corepack pnpm install --prod --frozen-lockfile --dir "$DEST"',
    );
    expect(readFileSync('scripts/install-major-runtime.sh', 'utf8')).toContain(
      'corepack pnpm install --frozen-lockfile',
    );
    for (const script of [
      'scripts/stage-major-release-candidate.sh',
      'scripts/verify-major-staged-candidate.sh',
    ]) {
      const source = readFileSync(script, 'utf8');
      expect(source).toContain('require(process.argv[1]).version');
      expect(source).not.toContain('"version": "0.5.1"');
    }
  });
});
