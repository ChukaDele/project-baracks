import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db, DbConn } from '../db/client.js';
import {
  capabilityEvents,
  capabilityRecords,
  capabilityVerificationArtifacts,
  agentProviders,
  agentRuns,
  tasks,
  CAPABILITY_STATUSES,
  CAPABILITY_TYPES,
  CAPABILITY_VALIDATION_STATES,
  verificationRuns,
  type CapabilityStatus,
} from '../db/schema.js';
import { newId, nowIso } from '../domain/ids.js';
import { redactText } from '../security/redact.js';
import {
  LOCAL_CATALOG_VALIDATOR,
  RUNTIME_ADAPTER_REFERENCE,
  runtimeAdapterRevision,
  verifyRuntimeAdapter,
} from './verifier.js';

const sourceKinds = [
  'local_tool',
  'internal_adapter',
  'installed_integration',
  'first_party_sdk',
  'open_source',
  'small_adapter',
  'bespoke',
] as const;

const sourceRank = new Map(sourceKinds.map((kind, index) => [kind, index]));

export const capabilityCandidateSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  name: z.string().min(1).max(160),
  description: z.string().min(1).max(1_000),
  type: z.enum(CAPABILITY_TYPES),
  operations: z.array(z.string().min(1).max(120)).min(1).max(24),
  riskLevel: z.enum(['low', 'medium', 'high']),
  costProfile: z.enum(['none', 'subscription', 'paid', 'unknown']),
  permissions: z.array(z.string().min(1).max(160)).max(24).default([]),
  source: z.object({
    kind: z.enum(sourceKinds),
    reference: z.string().min(1).max(1_000),
    license: z.string().max(160).optional(),
    revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  provenance: z.object({
    discoveredBy: z.string().min(1).max(160),
    evidence: z.string().min(1).max(2_000),
  }),
  preflight: z.object({
    dependencyReviewed: z.boolean(),
    permissionsReviewed: z.boolean(),
    secretsSafe: z.boolean(),
    telemetryReviewed: z.boolean(),
    compatibilityChecked: z.boolean(),
    smokeTestPassed: z.boolean(),
    failureBehaviorPassed: z.boolean(),
  }),
});

export type CapabilityCandidate = z.infer<typeof capabilityCandidateSchema>;

export interface CapabilityAssessment {
  candidate: CapabilityCandidate;
  accepted: boolean;
  reasons: string[];
}

export interface CapabilityRecord {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string;
  type: CapabilityCandidate['type'];
  operations: string[];
  riskLevel: CapabilityCandidate['riskLevel'];
  source: CapabilityCandidate['source'];
  sourceFingerprint: string;
  provenance: CapabilityCandidate['provenance'];
  verificationArtifactId: string | null;
  status: CapabilityStatus;
  validationState: (typeof CAPABILITY_VALIDATION_STATES)[number];
  successCount: number;
  failureCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityVerificationArtifact {
  operation: string;
  fixture: Record<string, unknown>;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  validator: string;
  environment: Record<string, unknown>;
  security: Record<string, unknown>;
  passed: boolean;
}

export type AcquisitionPlan =
  | { kind: 'reuse'; capability: CapabilityRecord }
  | { kind: 'provision'; assessment: CapabilityAssessment }
  | { kind: 'blocked'; reasons: string[] };

function parseRecord(row: typeof capabilityRecords.$inferSelect): CapabilityRecord {
  return {
    ...row,
    type: row.type,
    operations: JSON.parse(row.operationsJson) as string[],
    source: JSON.parse(row.sourceJson) as CapabilityCandidate['source'],
    provenance: JSON.parse(row.provenanceJson) as CapabilityCandidate['provenance'],
    status: row.status,
    validationState: row.validationState,
  };
}

function operationsFor(
  row: Pick<typeof capabilityRecords.$inferSelect, 'operationsJson'>,
): string[] {
  const parsed: unknown = JSON.parse(row.operationsJson);
  if (!Array.isArray(parsed)) throw new Error('capability record has invalid operations');
  const operations: string[] = [];
  for (const operation of parsed) {
    if (typeof operation !== 'string') throw new Error('capability record has invalid operations');
    operations.push(operation);
  }
  return operations;
}

export function capabilitySourceFingerprint(source: CapabilityCandidate['source']): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

/** Immutable binding that a verifier must record before it can validate one
 * capability version and operation. */
export function capabilityValidationSubject(
  capability: Pick<CapabilityRecord, 'id' | 'sourceFingerprint'>,
  operation: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        capabilityId: capability.id,
        sourceFingerprint: capability.sourceFingerprint,
        operation,
      }),
    )
    .digest('hex');
}

function recordEvent(
  db: DbConn,
  capabilityId: string,
  kind: typeof capabilityEvents.$inferInsert.kind,
  evidence: unknown,
) {
  db.insert(capabilityEvents)
    .values({
      id: newId('cevt'),
      capabilityId,
      kind,
      evidenceJson: JSON.stringify(evidence),
    })
    .run();
}

/**
 * Evaluate a candidate without installing, invoking, or trusting it. The
 * caller must supply observed preflight results; this function only decides
 * whether those facts satisfy Major's reversible acquisition boundary.
 */
export function assessCapabilityCandidate(input: CapabilityCandidate): CapabilityAssessment {
  const candidate = capabilityCandidateSchema.parse(input);
  const reasons: string[] = [];
  if (candidate.riskLevel === 'high') reasons.push('high-risk capability requires a human gate');
  if (candidate.costProfile !== 'none') {
    reasons.push('capability cost is not proven to add zero spend');
  }
  if (candidate.source.kind === 'open_source' && !candidate.source.license) {
    reasons.push('open-source candidates require a recorded license');
  }
  if (
    candidate.permissions.some((permission) =>
      /credential|production|destructive/i.test(permission),
    )
  ) {
    reasons.push('requested permissions exceed Toolsmith provisional scope');
  }
  for (const [name, passed] of Object.entries(candidate.preflight)) {
    if (!passed) reasons.push(`preflight check failed: ${name}`);
  }
  return { candidate, accepted: reasons.length === 0, reasons };
}

export function listCapabilities(db: Db, projectId: string): CapabilityRecord[] {
  return db
    .select()
    .from(capabilityRecords)
    .where(eq(capabilityRecords.projectId, projectId))
    .all()
    .map(parseRecord);
}

export function getCapability(db: Db, id: string): CapabilityRecord {
  const row = db.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get();
  if (!row) throw new Error(`capability not found: ${id}`);
  return parseRecord(row);
}

function artifactMatchesRecord(db: Db, capability: CapabilityRecord): boolean {
  if (!capability.verificationArtifactId) return false;
  const artifact = db
    .select()
    .from(capabilityVerificationArtifacts)
    .where(eq(capabilityVerificationArtifacts.id, capability.verificationArtifactId))
    .get();
  return Boolean(
    artifact &&
    artifact.capabilityId === capability.id &&
    artifact.status === 'passed' &&
    artifact.sourceFingerprint === capability.sourceFingerprint,
  );
}

/** Prefer a proven project capability before considering a new candidate. */
export function planCapabilityAcquisition(
  db: Db,
  input: { projectId: string; operation: string; candidates: CapabilityCandidate[] },
): AcquisitionPlan {
  const reusable = listCapabilities(db, input.projectId)
    .filter(
      (capability) =>
        capability.operations.includes(input.operation) &&
        (capability.status === 'preferred' || capability.status === 'validated') &&
        ['independently_validated', 'capability_verified'].includes(capability.validationState) &&
        artifactMatchesRecord(db, capability),
    )
    .sort(
      (left, right) =>
        Number(right.status === 'preferred') - Number(left.status === 'preferred') ||
        right.successCount - left.successCount ||
        left.failureCount - right.failureCount,
    )[0];
  if (reusable) return { kind: 'reuse', capability: reusable };

  const assessments = input.candidates
    .map(assessCapabilityCandidate)
    .filter((assessment) => assessment.candidate.operations.includes(input.operation))
    .sort(
      (left, right) =>
        Number(right.accepted) - Number(left.accepted) ||
        (sourceRank.get(left.candidate.source.kind) ?? Number.MAX_SAFE_INTEGER) -
          (sourceRank.get(right.candidate.source.kind) ?? Number.MAX_SAFE_INTEGER),
    );
  const next = assessments.find((assessment) => assessment.accepted);
  if (next) return { kind: 'provision', assessment: next };
  return {
    kind: 'blocked',
    reasons:
      assessments.flatMap((assessment) => assessment.reasons).length > 0
        ? assessments.flatMap((assessment) => assessment.reasons)
        : ['no candidate supports the requested operation'],
  };
}

/**
 * Store a preflight-passing candidate as provisional. It remains unavailable
 * to the resolver until independent validation succeeds.
 */
export function provisionCapability(
  db: Db,
  input: { projectId: string; candidate: CapabilityCandidate },
): CapabilityRecord {
  const assessment = assessCapabilityCandidate(input.candidate);
  if (!assessment.accepted) {
    throw new Error(`capability cannot be provisioned: ${assessment.reasons.join('; ')}`);
  }
  const candidate = assessment.candidate;
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(capabilityRecords)
      .where(
        and(
          eq(capabilityRecords.projectId, input.projectId),
          eq(capabilityRecords.key, candidate.key),
        ),
      )
      .get();
    if (existing) {
      const nextFingerprint = capabilitySourceFingerprint(candidate.source);
      if (existing.sourceFingerprint === nextFingerprint) {
        throw new Error(`capability already registered: ${candidate.key}`);
      }
      if (!['degraded', 'blocked', 'deprecated'].includes(existing.status)) {
        throw new Error(`capability source changed while still active: ${candidate.key}`);
      }
      const now = nowIso();
      tx.update(capabilityRecords)
        .set({
          name: candidate.name,
          description: candidate.description,
          type: candidate.type,
          operationsJson: JSON.stringify(candidate.operations),
          riskLevel: candidate.riskLevel,
          sourceJson: JSON.stringify(candidate.source),
          sourceFingerprint: nextFingerprint,
          provenanceJson: JSON.stringify(candidate.provenance),
          verificationArtifactId: null,
          status: 'provisional',
          validationState: 'preflight_passed',
          updatedAt: now,
        })
        .where(eq(capabilityRecords.id, existing.id))
        .run();
      recordEvent(tx, existing.id, 'provisioned', {
        preflight: candidate.preflight,
        provenance: candidate.provenance,
        replacesSourceFingerprint: existing.sourceFingerprint,
      });
      return parseRecord(
        tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, existing.id)).get()!,
      );
    }
    const id = newId('cap');
    tx.insert(capabilityRecords)
      .values({
        id,
        projectId: input.projectId,
        key: candidate.key,
        name: candidate.name,
        description: candidate.description,
        type: candidate.type,
        operationsJson: JSON.stringify(candidate.operations),
        riskLevel: candidate.riskLevel,
        sourceJson: JSON.stringify(candidate.source),
        sourceFingerprint: capabilitySourceFingerprint(candidate.source),
        provenanceJson: JSON.stringify(candidate.provenance),
        status: 'provisional',
        validationState: 'preflight_passed',
      })
      .run();
    recordEvent(tx, id, 'provisioned', {
      preflight: candidate.preflight,
      provenance: candidate.provenance,
    });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get()!,
    );
  });
}

/** An independent, evidenced validation is required before normal reuse. */
export function validateCapability(
  db: Db,
  input: {
    id: string;
    passed: boolean;
    reviewer: string;
    evidence: string;
    verificationRunId: string;
    artifact: CapabilityVerificationArtifact;
  },
): CapabilityRecord {
  if (!input.reviewer.trim() || !input.evidence.trim() || !input.verificationRunId.trim()) {
    throw new Error(
      'capability validation requires independent reviewer, evidence, and verification run',
    );
  }
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(capabilityRecords)
      .where(eq(capabilityRecords.id, input.id))
      .get();
    if (!current) throw new Error(`capability not found: ${input.id}`);
    if (current.status !== 'provisional') {
      throw new Error(
        `only provisional capabilities can be validated (current: ${current.status})`,
      );
    }
    const provenance = JSON.parse(current.provenanceJson) as CapabilityCandidate['provenance'];
    if (provenance.discoveredBy.trim().toLowerCase() === input.reviewer.trim().toLowerCase()) {
      throw new Error(
        'capability validation reviewer must be independent from the candidate discoverer',
      );
    }
    const verification = tx
      .select({
        status: verificationRuns.status,
        taskId: verificationRuns.taskId,
        validationSubject: verificationRuns.validationSubject,
        projectId: tasks.projectId,
        runStatus: agentRuns.status,
        provider: agentProviders.name,
      })
      .from(verificationRuns)
      .innerJoin(agentRuns, eq(agentRuns.id, verificationRuns.agentRunId))
      .innerJoin(agentProviders, eq(agentProviders.id, agentRuns.providerId))
      .innerJoin(tasks, eq(tasks.id, verificationRuns.taskId))
      .where(eq(verificationRuns.id, input.verificationRunId))
      .get();
    if (
      !verification ||
      verification.status !== 'passed' ||
      verification.runStatus !== 'succeeded' ||
      verification.provider !== input.reviewer ||
      verification.projectId !== current.projectId ||
      verification.validationSubject !==
        capabilityValidationSubject(current, input.artifact.operation)
    ) {
      throw new Error(
        'capability validation requires a passed run from the named independent reviewer',
      );
    }
    const artifact = input.artifact;
    if (
      !current.operationsJson ||
      !operationsFor(current).includes(artifact.operation) ||
      !artifact.validator.trim() ||
      Object.keys(artifact.fixture).length === 0 ||
      Object.keys(artifact.expected).length === 0 ||
      Object.keys(artifact.actual).length === 0 ||
      Object.keys(artifact.environment).length === 0 ||
      Object.keys(artifact.security).length === 0
    ) {
      throw new Error('capability validation requires a complete capability-specific artifact');
    }
    const now = nowIso();
    const artifactId = newId('cvar');
    tx.insert(capabilityVerificationArtifacts)
      .values({
        id: artifactId,
        capabilityId: current.id,
        sourceFingerprint: current.sourceFingerprint,
        operation: artifact.operation,
        fixtureJson: JSON.stringify(artifact.fixture),
        expectedJson: JSON.stringify(artifact.expected),
        actualJson: JSON.stringify(artifact.actual),
        validator: redactText(artifact.validator).slice(0, 500),
        environmentJson: JSON.stringify(artifact.environment),
        securityJson: JSON.stringify(artifact.security),
        status: artifact.passed && input.passed ? 'passed' : 'failed',
        verificationRunId: input.verificationRunId,
        validationSubject: capabilityValidationSubject(current, artifact.operation),
      })
      .run();
    const passed = input.passed && artifact.passed;
    tx.update(capabilityRecords)
      .set({
        status: passed ? 'validated' : 'blocked',
        validationState: passed ? 'independently_validated' : 'failed',
        verificationArtifactId: artifactId,
        updatedAt: now,
      })
      .where(eq(capabilityRecords.id, input.id))
      .run();
    recordEvent(tx, input.id, passed ? 'validated' : 'validation_failed', {
      reviewer: redactText(input.reviewer).slice(0, 160),
      verificationRunId: input.verificationRunId,
      evidence: redactText(input.evidence).slice(0, 2_000),
      verificationArtifactId: artifactId,
    });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, input.id)).get()!,
    );
  });
}

/** Persist a Toolsmith-owned local verification. It is allowed only for a
 * discovered capability whose verifier produced the artifact itself. */
export function validateDiscoveredCapability(
  db: Db,
  input: { id: string; repoPath: string },
): CapabilityRecord {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(capabilityRecords)
      .where(eq(capabilityRecords.id, input.id))
      .get();
    if (!current) throw new Error(`capability not found: ${input.id}`);
    if (current.status !== 'provisional') {
      throw new Error(`only provisional capabilities can be verified (current: ${current.status})`);
    }
    const provenance = parseRecord(current).provenance;
    const source = parseRecord(current).source;
    if (
      provenance.discoveredBy.trim().toLowerCase() === LOCAL_CATALOG_VALIDATOR ||
      current.type !== 'adapter' ||
      current.key !== 'canonicalize-local-path' ||
      source.kind !== 'internal_adapter' ||
      source.reference !== RUNTIME_ADAPTER_REFERENCE ||
      source.revision !== runtimeAdapterRevision()
    ) {
      throw new Error('Toolsmith validation requires the registered independent local verifier');
    }
    const artifact = verifyRuntimeAdapter(input.repoPath);
    if (
      !operationsFor(current).includes(artifact.operation) ||
      !artifact.validator.trim() ||
      Object.keys(artifact.fixture).length === 0 ||
      Object.keys(artifact.expected).length === 0 ||
      Object.keys(artifact.actual).length === 0 ||
      Object.keys(artifact.environment).length === 0 ||
      Object.keys(artifact.security).length === 0
    ) {
      throw new Error('Toolsmith verification artifact is incomplete');
    }
    const artifactId = newId('cvar');
    tx.insert(capabilityVerificationArtifacts)
      .values({
        id: artifactId,
        capabilityId: current.id,
        sourceFingerprint: current.sourceFingerprint,
        operation: artifact.operation,
        fixtureJson: JSON.stringify(artifact.fixture),
        expectedJson: JSON.stringify(artifact.expected),
        actualJson: JSON.stringify(artifact.actual),
        validator: redactText(artifact.validator).slice(0, 500),
        environmentJson: JSON.stringify(artifact.environment),
        securityJson: JSON.stringify(artifact.security),
        status: artifact.passed ? 'passed' : 'failed',
        validationSubject: capabilityValidationSubject(current, artifact.operation),
      })
      .run();
    const now = nowIso();
    tx.update(capabilityRecords)
      .set({
        status: artifact.passed ? 'validated' : 'blocked',
        validationState: artifact.passed ? 'capability_verified' : 'failed',
        verificationArtifactId: artifactId,
        updatedAt: now,
      })
      .where(eq(capabilityRecords.id, input.id))
      .run();
    recordEvent(tx, input.id, artifact.passed ? 'validated' : 'validation_failed', {
      verifier: 'toolsmith-local',
      verificationArtifactId: artifactId,
      sourceFingerprint: current.sourceFingerprint,
    });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, input.id)).get()!,
    );
  });
}

/** Source-content drift withdraws reuse before a new revision is provisioned. */
export function invalidateCapabilitySource(db: Db, id: string): CapabilityRecord {
  return db.transaction((tx) => {
    const current = tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get();
    if (!current) throw new Error(`capability not found: ${id}`);
    const now = nowIso();
    tx.update(capabilityRecords)
      .set({
        status: 'degraded',
        validationState: 'failed',
        verificationArtifactId: null,
        updatedAt: now,
      })
      .where(eq(capabilityRecords.id, id))
      .run();
    recordEvent(tx, id, 'validation_failed', {
      reason: 'source fingerprint changed',
      sourceFingerprint: current.sourceFingerprint,
    });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get()!,
    );
  });
}

/** A verifier error cannot leave a candidate provisionally admissible. */
export function blockCapabilityVerification(db: Db, id: string, reason: string): CapabilityRecord {
  if (!reason.trim()) throw new Error('capability verification block requires a reason');
  return db.transaction((tx) => {
    const current = tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get();
    if (!current) throw new Error(`capability not found: ${id}`);
    if (current.status !== 'provisional') {
      throw new Error(`only provisional capabilities can be blocked (current: ${current.status})`);
    }
    tx.update(capabilityRecords)
      .set({ status: 'blocked', validationState: 'failed', updatedAt: nowIso() })
      .where(eq(capabilityRecords.id, id))
      .run();
    recordEvent(tx, id, 'validation_failed', { reason: redactText(reason).slice(0, 2_000) });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get()!,
    );
  });
}

/** A worker may report a use, but that report never contributes to promotion. */
export function recordReportedCapabilityUse(db: Db, input: { id: string; evidence: string }): void {
  if (!input.evidence.trim()) throw new Error('reported capability use requires evidence');
  const capability = db
    .select()
    .from(capabilityRecords)
    .where(eq(capabilityRecords.id, input.id))
    .get();
  if (!capability || !['validated', 'preferred'].includes(capability.status)) {
    throw new Error('reported capability use requires a validated capability');
  }
  recordEvent(db, input.id, 'reported_use', {
    evidence: redactText(input.evidence).slice(0, 2_000),
  });
}

/** Record field outcomes. Repeated failures degrade routing without deleting provenance. */
export function recordCapabilityOutcome(
  db: Db,
  input: { id: string; success: boolean; evidence: string; at?: string },
): CapabilityRecord {
  if (!input.evidence.trim()) throw new Error('capability outcome requires evidence');
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(capabilityRecords)
      .where(eq(capabilityRecords.id, input.id))
      .get();
    if (!current) throw new Error(`capability not found: ${input.id}`);
    if (!['validated', 'preferred', 'degraded'].includes(current.status)) {
      throw new Error(
        `capability must be validated before recording use (current: ${current.status})`,
      );
    }
    const failureCount = current.failureCount + Number(!input.success);
    const now = input.at ?? nowIso();
    const status = !input.success && failureCount >= 2 ? 'degraded' : current.status;
    tx.update(capabilityRecords)
      .set({
        successCount: current.successCount + Number(input.success),
        failureCount,
        status,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(capabilityRecords.id, input.id))
      .run();
    recordEvent(tx, input.id, 'outcome', {
      success: input.success,
      evidence: redactText(input.evidence).slice(0, 2_000),
    });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, input.id)).get()!,
    );
  });
}

export function preferCapability(db: Db, id: string): CapabilityRecord {
  return db.transaction((tx) => {
    const current = tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get();
    if (!current) throw new Error(`capability not found: ${id}`);
    if (current.status !== 'validated' || current.successCount < 2 || current.failureCount > 0) {
      throw new Error(
        'preferred capability requires two successful validated uses and no failures',
      );
    }
    tx.update(capabilityRecords)
      .set({ status: 'preferred', updatedAt: nowIso() })
      .where(eq(capabilityRecords.id, id))
      .run();
    recordEvent(tx, id, 'preferred', { successfulUses: current.successCount });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get()!,
    );
  });
}

export function deprecateCapability(db: Db, id: string, evidence: string): CapabilityRecord {
  if (!evidence.trim()) throw new Error('capability deprecation requires evidence');
  return db.transaction((tx) => {
    const current = tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get();
    if (!current) throw new Error(`capability not found: ${id}`);
    tx.update(capabilityRecords)
      .set({ status: 'deprecated', updatedAt: nowIso() })
      .where(eq(capabilityRecords.id, id))
      .run();
    recordEvent(tx, id, 'deprecated', { evidence: redactText(evidence).slice(0, 2_000) });
    return parseRecord(
      tx.select().from(capabilityRecords).where(eq(capabilityRecords.id, id)).get()!,
    );
  });
}

export const capabilityLifecycleStatuses = CAPABILITY_STATUSES;
