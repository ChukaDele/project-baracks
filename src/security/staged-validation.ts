import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import { validationLeases } from '../db/schema.js';
import { newId } from '../domain/ids.js';
import type { BackendExecuteRequest } from '../execution/backend.js';
import type { ProviderCommandHost } from '../providers/commands.js';
import { providerArgs } from '../providers/commands.js';
import type { ExecuteOutcome, ProviderEvent } from '../providers/types.js';
import type { ProviderApprovalAuthority } from './provider-approval-policy.js';
import { isCapabilityAvailable } from './capabilities.js';
import { verifySecureEnclaveStagedValidationAuthority } from './secure-enclave-attestation.js';

export type MajorActivationState = 'disabled' | 'staged_validation' | 'supervised' | 'unattended';

export const STAGED_VALIDATION_CASES = [
  'provider-field',
  'clean-install',
  'jss-field',
  'surface-talent-field',
  'cross-project-isolation',
  'burn-in-1',
  'burn-in-2',
  'burn-in-3',
] as const;
export type StagedValidationCase = (typeof STAGED_VALIDATION_CASES)[number];

const MAX_LEASE_MS = 30 * 60 * 1000;
const SHA_40 = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;

export class StagedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagedValidationError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

export function stagedValidationEventsDigest(events: readonly ProviderEvent[]): string {
  return sha256(canonicalJson(events.map((event) => ({ type: event.type, data: event.data }))));
}

export function stagedValidationWorkspaceDigest(workspace: string): string {
  const root = realpathSync(workspace);
  const hash = createHash('sha256');
  for (const name of readdirSync(root)
    .filter((entry) => entry !== '.git')
    .sort()) {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new StagedValidationError('field workspace contains a non-regular artifact');
    }
    hash.update(`${name}\0${stat.mode & 0o777}\0`);
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

export interface StagedValidationRequestShape {
  executable: string;
  args: readonly string[];
  cwd: string;
  providerRequest: Omit<
    NonNullable<BackendExecuteRequest['providerRequest']>,
    'approvalAuthority'
  > & {
    approvalAuthority: ProviderApprovalAuthority;
  };
}

/** Complete immutable request identity. Raw prompt/output never enters the lease row. */
export function stagedValidationRequestDigest(request: StagedValidationRequestShape): string {
  const intent = request.providerRequest;
  return sha256(
    canonicalJson({
      executable: request.executable,
      args: [...request.args],
      cwd: realpathSync(request.cwd),
      host: intent.host,
      prompt: intent.prompt,
      allowGuestMutation: intent.allowGuestMutation,
      modelRef: intent.modelRef ?? null,
      resumeSessionRefHash: intent.resumeSessionRef ? sha256(intent.resumeSessionRef) : null,
      approvalAuthority: intent.approvalAuthority,
    }),
  );
}

export interface IssueStagedValidationLeaseInput {
  releaseRepository: string;
  releaseSourceCheckout: string;
  releaseRoot: string;
  releaseBranch: string;
  releaseSha: string;
  releaseTreeHash: string;
  releaseManifestHash: string;
  provider: ProviderCommandHost;
  projectIdentityHash: string;
  projectRootHash: string;
  caseId: StagedValidationCase;
  requestDigest: string;
  expectedEvidenceHash: string;
  expectedExecutionStatus: 'succeeded' | 'cancelled';
  validationNonce: string;
  workerId: string;
  processNonce: string;
  resourceLeaseId?: string;
  predecessorLeaseId?: string;
  leaseMs?: number;
  now?: () => Date;
}

export interface StagedValidationLeaseSecret {
  leaseId: string;
  token: string;
  expiresAt: string;
}

export interface StagedValidationExecutionAuthority {
  readonly kind: 'staged_validation';
  readonly leaseId: string;
  readonly token: string;
  readonly requestDigest: string;
  readonly releaseSha: string;
  readonly workerId: string;
  readonly processNonce: string;
}

export interface SupervisedExecutionAuthority {
  readonly kind: 'supervised';
}

export type BackendExecutionAuthority =
  StagedValidationExecutionAuthority | SupervisedExecutionAuthority;

/**
 * Verify the independently issued Secure Enclave authority for this exact release.
 * SQLite remains a replay/evidence ledger and is never accepted as the trust root.
 */
function assertHex(label: string, value: string, pattern = SHA_256): void {
  if (!pattern.test(value)) throw new StagedValidationError(`${label} has an invalid digest`);
}

export function issueStagedValidationLease(
  db: Db,
  input: IssueStagedValidationLeaseInput,
): StagedValidationLeaseSecret {
  if (isCapabilityAvailable('live-agent-execution')) {
    throw new StagedValidationError('staged validation is unavailable after supervised activation');
  }
  assertHex('release SHA', input.releaseSha, SHA_40);
  for (const [label, value] of [
    ['release manifest', input.releaseManifestHash],
    ['release tree', input.releaseTreeHash],
    ['project identity', input.projectIdentityHash],
    ['project root', input.projectRootHash],
    ['request', input.requestDigest],
    ['expected evidence', input.expectedEvidenceHash],
  ] as const) {
    assertHex(label, value);
  }
  if (!STAGED_VALIDATION_CASES.includes(input.caseId)) {
    throw new StagedValidationError(`unknown staged validation case: ${input.caseId}`);
  }
  const leaseMs = input.leaseMs ?? MAX_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0 || leaseMs > MAX_LEASE_MS) {
    throw new StagedValidationError(`lease duration must be between 1 and ${MAX_LEASE_MS}ms`);
  }
  const token = randomBytes(32).toString('hex');
  const now = input.now?.() ?? new Date();
  const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
  if (realpathSync(input.releaseRoot) !== executingRoot) {
    throw new StagedValidationError('staged validation can issue only from the executing runtime');
  }
  const secureEnclaveAuthority = verifySecureEnclaveStagedValidationAuthority({
    releaseSha: input.releaseSha,
    caseId: input.caseId,
    provider: input.provider,
  });
  if (secureEnclaveAuthority.expiresAt <= now.toISOString()) {
    throw new StagedValidationError('Secure Enclave staged-validation authority is expired');
  }
  if (input.validationNonce !== secureEnclaveAuthority.validationNonce) {
    throw new StagedValidationError('validation nonce does not match Secure Enclave authority');
  }
  if (input.predecessorLeaseId) {
    const predecessor = getLease(db, input.predecessorLeaseId);
    if (
      predecessor.status !== 'succeeded' ||
      predecessor.provider !== 'cursor' ||
      predecessor.releaseSha !== input.releaseSha ||
      predecessor.projectIdentityHash !== input.projectIdentityHash ||
      predecessor.projectRootHash !== input.projectRootHash ||
      !predecessor.resultSessionRefHash ||
      !predecessor.resultModel
    ) {
      throw new StagedValidationError(
        'Cursor resume predecessor is not a matching validated create',
      );
    }
  }
  const lease = {
    id: newId('vlease'),
    tokenHash: sha256(token),
    authorityLeaseId: secureEnclaveAuthority.leaseId,
    authorityArtifactDigest: secureEnclaveAuthority.artifactDigest,
    authorityValidationNonce: secureEnclaveAuthority.validationNonce,
    authorityExpiresAt: secureEnclaveAuthority.expiresAt,
    releaseRepository: input.releaseRepository,
    releaseSourceCheckout: realpathSync(input.releaseSourceCheckout),
    releaseRoot: realpathSync(input.releaseRoot),
    releaseBranch: input.releaseBranch,
    releaseSha: input.releaseSha,
    releaseTreeHash: input.releaseTreeHash,
    releaseManifestHash: input.releaseManifestHash,
    provider: input.provider,
    projectIdentityHash: input.projectIdentityHash,
    projectRootHash: input.projectRootHash,
    caseId: input.caseId,
    requestDigest: input.requestDigest,
    expectedEvidenceHash: input.expectedEvidenceHash,
    expectedExecutionStatus: input.expectedExecutionStatus,
    workerId: input.workerId,
    processNonce: input.processNonce,
    ...(input.resourceLeaseId ? { resourceLeaseId: input.resourceLeaseId } : {}),
    ...(input.predecessorLeaseId ? { predecessorLeaseId: input.predecessorLeaseId } : {}),
    status: 'issued' as const,
    expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
  };
  recoverStaleValidationLeases(db, () => now);
  db.insert(validationLeases).values(lease).run();
  return { leaseId: lease.id, token, expiresAt: lease.expiresAt };
}

function tokenMatches(actualHash: string, token: string): boolean {
  const expected = Buffer.from(actualHash, 'hex');
  const actual = Buffer.from(sha256(token), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getLease(db: DbConn, leaseId: string) {
  const row = db.select().from(validationLeases).where(eq(validationLeases.id, leaseId)).get();
  if (!row) throw new StagedValidationError(`staged validation lease not found: ${leaseId}`);
  return row;
}

export function getStagedValidationLease(db: DbConn, leaseId: string) {
  return getLease(db, leaseId);
}

export function assertStagedValidationScope(
  lease: ReturnType<typeof getLease>,
  input: {
    provider: ProviderCommandHost;
    projectIdentityHash: string;
    projectRootHash: string;
    requestDigest: string;
    resourceLeaseId?: string;
  },
): void {
  if (
    lease.provider !== input.provider ||
    lease.projectIdentityHash !== input.projectIdentityHash ||
    lease.projectRootHash !== input.projectRootHash ||
    lease.requestDigest !== input.requestDigest ||
    !lease.resourceLeaseId ||
    lease.resourceLeaseId !== input.resourceLeaseId
  ) {
    throw new StagedValidationError(
      'staged validation scope does not match provider, project, request, or worker lease',
    );
  }
}

/**
 * Enforce the product-owned v0.5.1 field cases at both execution boundaries.
 * A lease label and caller-supplied digest never define a validation workload.
 */
export function assertStagedValidationCaseRequest(
  db: DbConn,
  lease: ReturnType<typeof getLease>,
  request: StagedValidationRequestShape,
): void {
  if (lease.caseId !== 'provider-field') {
    throw new StagedValidationError(`staged validation case is not executable: ${lease.caseId}`);
  }
  if (request.providerRequest.approvalAuthority.decisions.length !== 0) {
    throw new StagedValidationError('staged validation cannot carry provider approval authority');
  }
  const match = realpathSync(request.cwd).match(
    new RegExp(
      `^${join(homedir(), '.major', 'staged-validation', 'workspaces').replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}/([a-f0-9-]{36})/(claude|codex|antigravity|cursor-success|cursor-cancel)$`,
    ),
  );
  if (!match) throw new StagedValidationError('staged validation workspace is not product-owned');
  const [, nonce, workspaceKind] = match;
  if (nonce !== lease.authorityValidationNonce) {
    throw new StagedValidationError('field request nonce does not match Secure Enclave authority');
  }
  const intent = request.providerRequest;
  if (intent.host === 'cursor') {
    const phase =
      workspaceKind === 'cursor-cancel' ? 'cancel' : intent.resumeSessionRef ? 'resume' : 'create';
    const prompt =
      phase === 'create'
        ? `Create CURSOR_ACP_FIELD.txt containing exactly MAJOR_CURSOR_ACP_FIELD_${nonce} followed by one newline. Do not modify any other file.`
        : phase === 'resume'
          ? `Continue this session. Create CURSOR_ACP_RESUME.txt containing exactly MAJOR_CURSOR_ACP_RESUME_${nonce} followed by one newline. Do not modify any other file.`
          : 'Analyze the repository in depth and prepare a long architecture report. Do not modify files or run shell commands.';
    if (
      workspaceKind !== (phase === 'cancel' ? 'cursor-cancel' : 'cursor-success') ||
      basename(request.executable) !== 'cursor-agent' ||
      request.args.length !== 1 ||
      request.args[0] !== 'acp' ||
      intent.prompt !== prompt ||
      intent.allowGuestMutation !== true ||
      (phase === 'resume'
        ? !intent.modelRef || !intent.resumeSessionRef
        : Boolean(intent.modelRef || intent.resumeSessionRef))
    ) {
      throw new StagedValidationError('request does not match the fixed Cursor field contract');
    }
    if (phase === 'resume') {
      if (!lease.predecessorLeaseId) {
        throw new StagedValidationError('Cursor resume is missing its validated create lease');
      }
      const predecessor = getLease(db, lease.predecessorLeaseId);
      if (
        predecessor.status !== 'succeeded' ||
        predecessor.releaseSha !== lease.releaseSha ||
        predecessor.projectIdentityHash !== lease.projectIdentityHash ||
        predecessor.projectRootHash !== lease.projectRootHash ||
        predecessor.resultSessionRefHash !== sha256(intent.resumeSessionRef!) ||
        predecessor.resultModel !== intent.modelRef
      ) {
        throw new StagedValidationError(
          'Cursor resume does not match its validated create session and model',
        );
      }
    } else if (lease.predecessorLeaseId) {
      throw new StagedValidationError('Cursor create/cancel cannot carry a predecessor lease');
    }
    return;
  }
  const definitions = {
    claude: { executable: 'claude', allowGuestMutation: true },
    codex: { executable: 'codex', allowGuestMutation: false },
    antigravity: { executable: 'agy', allowGuestMutation: false },
  } as const;
  const definition = definitions[intent.host];
  if (!definition || workspaceKind !== intent.host) {
    throw new StagedValidationError('request does not match a fixed CLI provider field');
  }
  const filename = `MAJOR_${intent.host.toUpperCase()}_FIELD.txt`;
  const expected = `MAJOR_${intent.host.toUpperCase()}_FIELD_${nonce}`;
  const prompt = definition.allowGuestMutation
    ? `Create ${filename} containing exactly ${expected} followed by one newline. Use only file reading and editing tools. Do not run a shell command. Do not modify any other file.`
    : `Read the empty repository and respond with exactly ${expected}. Do not use shell, network, or file-writing tools.`;
  const expectedArgs = providerArgs(intent.host, { prompt, outputMode: 'batch' });
  if (
    basename(request.executable) !== definition.executable ||
    intent.prompt !== prompt ||
    intent.allowGuestMutation !== definition.allowGuestMutation ||
    intent.modelRef !== undefined ||
    intent.resumeSessionRef !== undefined ||
    request.args.length !== expectedArgs.length ||
    request.args.some((value, index) => value !== expectedArgs[index])
  ) {
    throw new StagedValidationError('request does not match the fixed CLI provider field contract');
  }
}

/** Burn the one-use authority immediately before gateway/backend admission. */
export function admitStagedValidationLease(
  db: Db,
  input: StagedValidationExecutionAuthority,
  now: () => Date = () => new Date(),
) {
  return db.transaction(
    (tx) => {
      const row = getLease(tx, input.leaseId);
      if (!tokenMatches(row.tokenHash, input.token)) {
        throw new StagedValidationError('staged validation token is invalid');
      }
      if (
        row.releaseSha !== input.releaseSha ||
        row.requestDigest !== input.requestDigest ||
        row.workerId !== input.workerId ||
        row.processNonce !== input.processNonce
      ) {
        throw new StagedValidationError('staged validation authority does not match its lease');
      }
      const at = now().toISOString();
      const updated = tx
        .update(validationLeases)
        .set({ status: 'admitted', admittedAt: at })
        .where(
          and(
            eq(validationLeases.id, input.leaseId),
            eq(validationLeases.status, 'issued'),
            eq(validationLeases.workerId, input.workerId),
            eq(validationLeases.processNonce, input.processNonce),
          ),
        )
        .run();
      if (updated.changes !== 1 || row.expiresAt <= at) {
        throw new StagedValidationError('staged validation lease is expired, stale, or consumed');
      }
      return getLease(tx, input.leaseId);
    },
    { behavior: 'immediate' },
  );
}

/** Backend-side one-use consume. A second direct backend call cannot replay it. */
export function consumeStagedValidationExecution(
  db: Db,
  authority: StagedValidationExecutionAuthority,
  requestDigest: string,
  now: () => Date = () => new Date(),
) {
  return db.transaction(
    (tx) => {
      const row = getLease(tx, authority.leaseId);
      const at = now().toISOString();
      if (
        row.status !== 'admitted' ||
        row.expiresAt <= at ||
        row.releaseSha !== authority.releaseSha ||
        row.requestDigest !== requestDigest ||
        authority.requestDigest !== requestDigest ||
        row.workerId !== authority.workerId ||
        row.processNonce !== authority.processNonce ||
        !tokenMatches(row.tokenHash, authority.token)
      ) {
        throw new StagedValidationError('staged validation authority failed backend verification');
      }
      const updated = tx
        .update(validationLeases)
        .set({ status: 'running' })
        .where(
          and(eq(validationLeases.id, authority.leaseId), eq(validationLeases.status, 'admitted')),
        )
        .run();
      if (updated.changes !== 1) {
        throw new StagedValidationError('staged validation backend authority was already consumed');
      }
      return getLease(tx, authority.leaseId);
    },
    { behavior: 'immediate' },
  );
}

export function settleStagedValidationLease(
  db: Db,
  input: {
    authority: StagedValidationExecutionAuthority;
    status: 'validating' | 'failed' | 'cancelled';
    runId?: string;
    outcomeReason: string;
    evidenceHash: string;
    evidenceJson?: string;
    resultSessionRefHash?: string;
    resultModel?: string;
    resultEventHash?: string;
    resultEventCount?: number;
    resultWorkspaceHash?: string;
    now?: () => Date;
  },
) {
  assertHex('validation evidence', input.evidenceHash);
  const lease = getLease(db, input.authority.leaseId);
  if (!tokenMatches(lease.tokenHash, input.authority.token)) {
    throw new StagedValidationError('staged validation token is invalid for settlement');
  }
  const at = (input.now?.() ?? new Date()).toISOString();
  const result = db
    .update(validationLeases)
    .set({
      status: input.status,
      terminalAt: at,
      ...(input.runId ? { runId: input.runId } : {}),
      outcomeReason: input.outcomeReason,
      evidenceHash: input.evidenceHash,
      ...(input.evidenceJson ? { evidenceJson: input.evidenceJson } : {}),
      ...(input.resultSessionRefHash ? { resultSessionRefHash: input.resultSessionRefHash } : {}),
      ...(input.resultModel ? { resultModel: input.resultModel } : {}),
      ...(input.resultEventHash ? { resultEventHash: input.resultEventHash } : {}),
      ...(input.resultEventCount !== undefined ? { resultEventCount: input.resultEventCount } : {}),
      ...(input.resultWorkspaceHash ? { resultWorkspaceHash: input.resultWorkspaceHash } : {}),
    })
    .where(
      and(
        eq(validationLeases.id, input.authority.leaseId),
        eq(validationLeases.status, 'running'),
        eq(validationLeases.workerId, input.authority.workerId),
        eq(validationLeases.processNonce, input.authority.processNonce),
        ...(input.status === 'cancelled' ? [] : [gt(validationLeases.expiresAt, at)]),
      ),
    )
    .run();
  if (result.changes !== 1) {
    throw new StagedValidationError('staged validation lease is not live for settlement');
  }
  return getLease(db, input.authority.leaseId);
}

export function revokeStagedValidationLease(
  db: Db,
  leaseId: string,
  reason: string,
  now: () => Date = () => new Date(),
) {
  const result = db
    .update(validationLeases)
    .set({ status: 'cancelled', terminalAt: now().toISOString(), outcomeReason: reason })
    .where(
      and(
        eq(validationLeases.id, leaseId),
        inArray(validationLeases.status, ['issued', 'admitted', 'running', 'validating']),
      ),
    )
    .run();
  if (result.changes !== 1) throw new StagedValidationError('validation lease cannot be revoked');
  return getLease(db, leaseId);
}

export function recoverStaleValidationLeases(db: Db, now: () => Date = () => new Date()) {
  const at = now().toISOString();
  const result = db
    .update(validationLeases)
    .set({ status: 'expired', terminalAt: at, outcomeReason: 'validation lease expired' })
    .where(
      and(
        lt(validationLeases.expiresAt, at),
        inArray(validationLeases.status, ['issued', 'admitted', 'running', 'validating']),
      ),
    )
    .run();
  return result.changes;
}

export function currentActivationState(db: Db): MajorActivationState {
  if (isCapabilityAvailable('live-agent-execution')) return 'supervised';
  recoverStaleValidationLeases(db);
  const active = db
    .select({ id: validationLeases.id })
    .from(validationLeases)
    .where(eq(validationLeases.status, 'issued'))
    .get();
  const admitted = db
    .select({ id: validationLeases.id })
    .from(validationLeases)
    .where(eq(validationLeases.status, 'admitted'))
    .get();
  const running = db
    .select({ id: validationLeases.id })
    .from(validationLeases)
    .where(eq(validationLeases.status, 'running'))
    .get();
  const validating = db
    .select({ id: validationLeases.id })
    .from(validationLeases)
    .where(eq(validationLeases.status, 'validating'))
    .get();
  return active || admitted || running || validating ? 'staged_validation' : 'disabled';
}

function terminalizeStagedValidationEvidence(
  db: Db,
  authority: StagedValidationExecutionAuthority,
  contract: string,
  observedEvidence: Readonly<Record<string, unknown>>,
) {
  const lease = getLease(db, authority.leaseId);
  if (!tokenMatches(lease.tokenHash, authority.token)) {
    throw new StagedValidationError('staged validation token is invalid');
  }
  if (lease.expectedEvidenceHash !== sha256(contract)) {
    throw new StagedValidationError('validation evidence does not match the immutable contract');
  }
  const evidenceJson = canonicalJson(observedEvidence);
  if (Buffer.byteLength(evidenceJson) > 4096) {
    throw new StagedValidationError('validation evidence exceeds the durable bound');
  }
  const evidenceHash = sha256(evidenceJson);
  const at = new Date().toISOString();
  const result = db
    .update(validationLeases)
    .set({
      status: 'succeeded',
      terminalAt: at,
      outcomeReason: 'fixed validation contract passed; cleanup=complete',
      evidenceHash,
      evidenceJson,
    })
    .where(
      and(
        eq(validationLeases.id, authority.leaseId),
        eq(validationLeases.status, 'validating'),
        eq(validationLeases.workerId, authority.workerId),
        eq(validationLeases.processNonce, authority.processNonce),
        gt(validationLeases.expiresAt, at),
      ),
    )
    .run();
  if (result.changes !== 1) {
    throw new StagedValidationError('staged validation lease is not live for completion');
  }
  return getLease(db, authority.leaseId);
}

function assertCompletionIdentity(
  lease: ReturnType<typeof getLease>,
  authority: StagedValidationExecutionAuthority,
  workspace: string,
  outcome: ExecuteOutcome,
  events: readonly ProviderEvent[],
): void {
  const mismatches = [
    lease.status !== 'validating' && 'status',
    lease.runId !== outcome.runId && 'run-id',
    lease.projectRootHash !== sha256(realpathSync(workspace)) && 'workspace',
    outcome.cleanup !== 'complete' && 'cleanup',
    (outcome.sessionRef
      ? lease.resultSessionRefHash !== sha256(outcome.sessionRef)
      : lease.resultSessionRefHash !== null) && 'session',
    (outcome.actualModel ?? null) !== lease.resultModel && 'model',
    authority.releaseSha !== lease.releaseSha && 'release',
    authority.requestDigest !== lease.requestDigest && 'request',
    lease.resultEventCount !== events.length && 'event-count',
    lease.resultEventHash !== stagedValidationEventsDigest(events) && 'event-digest',
    lease.resultWorkspaceHash !== stagedValidationWorkspaceDigest(workspace) && 'workspace-digest',
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new StagedValidationError(
      `observed field result does not match the durable run: ${mismatches.join(', ')}`,
    );
  }
}

function eventText(events: readonly ProviderEvent[]): string {
  return events
    .map((event) => (typeof event.data === 'string' ? event.data : JSON.stringify(event.data)))
    .join('\n');
}

export function completeStagedCliProviderField(
  db: Db,
  authority: StagedValidationExecutionAuthority,
  input: {
    provider: Exclude<ProviderCommandHost, 'cursor'>;
    workspace: string;
    nonce: string;
    events: readonly ProviderEvent[];
    outcome: ExecuteOutcome;
  },
) {
  const lease = getLease(db, authority.leaseId);
  assertCompletionIdentity(lease, authority, input.workspace, input.outcome, input.events);
  if (
    lease.caseId !== 'provider-field' ||
    lease.provider !== input.provider ||
    input.outcome.status !== 'succeeded' ||
    input.outcome.modelSelection !== 'supported' ||
    input.events.length === 0 ||
    !/^[a-f0-9-]{36}$/.test(input.nonce)
  ) {
    throw new StagedValidationError('CLI provider result does not match the fixed field case');
  }
  const filename = `MAJOR_${input.provider.toUpperCase()}_FIELD.txt`;
  const expected = `MAJOR_${input.provider.toUpperCase()}_FIELD_${input.nonce}`;
  const visible = readdirSync(input.workspace).filter((name) => name !== '.git');
  const mutating = input.provider === 'claude';
  if (
    (mutating
      ? visible.length !== 1 ||
        visible[0] !== filename ||
        !existsSync(join(input.workspace, filename)) ||
        readFileSync(join(input.workspace, filename), 'utf8') !== `${expected}\n`
      : visible.length !== 0 || !eventText(input.events).includes(expected)) ||
    ((input.provider === 'claude' || input.provider === 'codex') && !input.outcome.sessionRef)
  ) {
    throw new StagedValidationError('CLI provider artifacts do not match the fixed field case');
  }
  return terminalizeStagedValidationEvidence(
    db,
    authority,
    `${input.provider}:${expected}:cleanup-complete`,
    {
      gate: 'provider-field',
      provider: input.provider,
      status: 'PASS',
      runId: input.outcome.runId ?? null,
      cleanup: 'complete',
      eventCount: input.events.length,
      sessionEvidence: input.outcome.sessionRef ? 'present' : 'unsupported',
      usageEvidence: input.outcome.usage === undefined ? 'unsupported' : 'present',
      workspaceEvidence: mutating ? 'exact-single-file' : 'empty',
      transcriptDigest: lease.resultEventHash,
      workspaceDigest: lease.resultWorkspaceHash,
    },
  );
}

export function completeStagedCursorField(
  db: Db,
  authority: StagedValidationExecutionAuthority,
  input: {
    phase: 'create' | 'resume' | 'cancel';
    workspace: string;
    nonce: string;
    events: readonly ProviderEvent[];
    outcome: ExecuteOutcome;
    expectedSessionRef?: string;
    expectedModel?: string;
  },
) {
  const lease = getLease(db, authority.leaseId);
  assertCompletionIdentity(lease, authority, input.workspace, input.outcome, input.events);
  const expectedStatus = input.phase === 'cancel' ? 'cancelled' : 'succeeded';
  const filename =
    input.phase === 'create'
      ? 'CURSOR_ACP_FIELD.txt'
      : input.phase === 'resume'
        ? 'CURSOR_ACP_RESUME.txt'
        : 'CURSOR_ACP_CANCEL_MUST_NOT_EXIST.txt';
  const expected =
    input.phase === 'create'
      ? `MAJOR_CURSOR_ACP_FIELD_${input.nonce}\n`
      : input.phase === 'resume'
        ? `MAJOR_CURSOR_ACP_RESUME_${input.nonce}\n`
        : undefined;
  const visible = readdirSync(input.workspace)
    .filter((name) => name !== '.git')
    .sort();
  const expectedVisible =
    input.phase === 'create'
      ? ['CURSOR_ACP_FIELD.txt']
      : input.phase === 'resume'
        ? ['CURSOR_ACP_FIELD.txt', 'CURSOR_ACP_RESUME.txt']
        : [];
  if (
    lease.caseId !== 'provider-field' ||
    lease.provider !== 'cursor' ||
    input.outcome.status !== expectedStatus ||
    input.outcome.modelSelection !== 'supported' ||
    input.events.length === 0 ||
    !/^[a-f0-9-]{36}$/.test(input.nonce) ||
    JSON.stringify(visible) !== JSON.stringify(expectedVisible) ||
    (expected
      ? !existsSync(join(input.workspace, filename)) ||
        readFileSync(join(input.workspace, filename), 'utf8') !== expected
      : existsSync(join(input.workspace, filename))) ||
    (input.phase === 'create' && (!input.outcome.sessionRef || !input.outcome.actualModel)) ||
    (input.phase === 'resume' &&
      (input.outcome.sessionRef !== input.expectedSessionRef ||
        input.outcome.requestedModel !== input.expectedModel ||
        input.outcome.actualModel !== input.expectedModel))
  ) {
    throw new StagedValidationError('Cursor artifacts do not match the fixed field case');
  }
  return terminalizeStagedValidationEvidence(
    db,
    authority,
    `cursor:${input.phase}:${input.nonce}:cleanup-complete`,
    {
      gate: 'provider-field',
      provider: 'cursor',
      phase: input.phase,
      status: 'PASS',
      runId: input.outcome.runId ?? null,
      cleanup: 'complete',
      eventCount: input.events.length,
      sessionEvidence: input.outcome.sessionRef ? 'present' : 'not-applicable',
      modelEvidence: input.outcome.actualModel ? 'present' : 'not-applicable',
      workspaceEvidence: input.phase === 'cancel' ? 'empty' : 'exact-file',
      transcriptDigest: lease.resultEventHash,
      workspaceDigest: lease.resultWorkspaceHash,
    },
  );
}
