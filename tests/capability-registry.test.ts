import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  assessCapabilityCandidate,
  capabilityValidationSubject,
  deprecateCapability,
  planCapabilityAcquisition,
  preferCapability,
  provisionCapability,
  recordCapabilityOutcome,
  validateCapability,
  type CapabilityCandidate,
  type CapabilityVerificationArtifact,
} from '../src/capabilities/registry.js';
import { addTask } from '../src/domain/task-service.js';
import { capabilityEvents } from '../src/db/schema.js';
import { recordQualifyingVerification, seedProject, testDb } from './helpers.js';

function candidate(overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return {
    key: 'structured-fetch',
    name: 'Structured fetch',
    description: 'Fetches a structured public response.',
    type: 'local_tool',
    operations: ['fetch-structured-data'],
    riskLevel: 'low',
    costProfile: 'none',
    permissions: [],
    source: { kind: 'local_tool', reference: 'bin/structured-fetch' },
    provenance: { discoveredBy: 'toolsmith-test', evidence: 'local help output' },
    preflight: {
      dependencyReviewed: true,
      permissionsReviewed: true,
      secretsSafe: true,
      telemetryReviewed: true,
      compatibilityChecked: true,
      smokeTestPassed: true,
      failureBehaviorPassed: true,
    },
    ...overrides,
  };
}

function independentProof(
  db: ReturnType<typeof testDb>,
  capability: { id: string; projectId: string; sourceFingerprint: string },
) {
  const task = addTask(db, { projectId: capability.projectId, title: 'capability validation' });
  return recordQualifyingVerification(db, task.id, {
    validationSubject: capabilityValidationSubject(capability, 'fetch-structured-data'),
  }).vrun.id;
}

function artifact(
  overrides: Partial<CapabilityVerificationArtifact> = {},
): CapabilityVerificationArtifact {
  return {
    operation: 'fetch-structured-data',
    fixture: { url: 'https://example.test/fixture' },
    expected: { status: 200 },
    actual: { status: 200 },
    validator: 'independent-fixture-validator',
    environment: { os: 'test' },
    security: { permissions: 'read-only' },
    passed: true,
    ...overrides,
  };
}

describe('Toolsmith capability lifecycle', () => {
  it('keeps a preflight-passing candidate provisional until independently validated', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisional = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const verificationRunId = independentProof(db, provisional);

    expect(provisional).toMatchObject({
      status: 'provisional',
      validationState: 'preflight_passed',
    });
    expect(
      planCapabilityAcquisition(db, {
        projectId: project.id,
        operation: 'fetch-structured-data',
        candidates: [],
      }),
    ).toMatchObject({ kind: 'blocked' });

    const validated = validateCapability(db, {
      id: provisional.id,
      passed: true,
      reviewer: 'test-provider',
      evidence: 'smoke, failure, security and compatibility checks passed',
      verificationRunId,
      artifact: artifact(),
    });
    expect(validated).toMatchObject({
      status: 'validated',
      validationState: 'independently_validated',
    });
    expect(() =>
      validateCapability(db, {
        id: provisional.id,
        passed: true,
        reviewer: 'toolsmith-test',
        evidence: 'self-review',
        verificationRunId,
        artifact: artifact(),
      }),
    ).toThrow(/only provisional/);
  });

  it('reuses a preferred existing capability before evaluating new candidates', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisioned = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const verificationRunId = independentProof(db, provisioned);
    validateCapability(db, {
      id: provisioned.id,
      passed: true,
      reviewer: 'test-provider',
      evidence: 'independent validation passed',
      verificationRunId,
      artifact: artifact(),
    });
    recordCapabilityOutcome(db, { id: provisioned.id, success: true, evidence: 'first success' });
    recordCapabilityOutcome(db, { id: provisioned.id, success: true, evidence: 'second success' });
    const preferred = preferCapability(db, provisioned.id);

    const plan = planCapabilityAcquisition(db, {
      projectId: project.id,
      operation: 'fetch-structured-data',
      candidates: [candidate({ key: 'replacement-fetch', name: 'Replacement fetch' })],
    });
    expect(plan).toMatchObject({
      kind: 'reuse',
      capability: { id: preferred.id, status: 'preferred' },
    });
  });

  it('rejects unsafe or authority-expanding candidates before registration', () => {
    expect(assessCapabilityCandidate(candidate({ riskLevel: 'high' }))).toMatchObject({
      accepted: false,
    });
    expect(assessCapabilityCandidate(candidate({ costProfile: 'paid' }))).toMatchObject({
      accepted: false,
    });
    expect(
      assessCapabilityCandidate(
        candidate({
          permissions: ['credential scope change'],
          preflight: { ...candidate().preflight, telemetryReviewed: false },
        }),
      ).reasons,
    ).toEqual(
      expect.arrayContaining([
        'requested permissions exceed Toolsmith provisional scope',
        'preflight check failed: telemetryReviewed',
      ]),
    );
  });

  it('refuses validation by the candidate discoverer', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisioned = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const verificationRunId = independentProof(db, provisioned);
    expect(() =>
      validateCapability(db, {
        id: provisioned.id,
        passed: true,
        reviewer: 'toolsmith-test',
        evidence: 'self-assessed',
        verificationRunId,
        artifact: artifact(),
      }),
    ).toThrow(/independent/);
  });

  it('refuses a capability-bound verification run from another project', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisional = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const otherProject = seedProject(db, 'other-project');
    const otherTask = addTask(db, { projectId: otherProject.id, title: 'unrelated validation' });
    const unrelatedRunId = recordQualifyingVerification(db, otherTask.id, {
      validationSubject: capabilityValidationSubject(provisional, 'fetch-structured-data'),
    }).vrun.id;

    expect(() =>
      validateCapability(db, {
        id: provisional.id,
        passed: true,
        reviewer: 'test-provider',
        evidence: 'unrelated run cannot validate this project capability',
        verificationRunId: unrelatedRunId,
        artifact: artifact(),
      }),
    ).toThrow(/passed run from the named independent reviewer/);
  });

  it('records a failed artifact as validation_failed even when the caller requests pass', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisioned = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const verificationRunId = independentProof(db, provisioned);
    const validated = validateCapability(db, {
      id: provisioned.id,
      passed: true,
      reviewer: 'test-provider',
      evidence: 'reviewer attempted validation',
      verificationRunId,
      artifact: artifact({ passed: false, actual: { status: 500 } }),
    });
    expect(validated.status).toBe('blocked');
    expect(
      db
        .select()
        .from(capabilityEvents)
        .where(eq(capabilityEvents.capabilityId, provisioned.id))
        .all()
        .at(-1),
    ).toMatchObject({ kind: 'validation_failed' });
  });

  it('degrades repeated failures and preserves append-only provenance when deprecated', () => {
    const db = testDb();
    const project = seedProject(db);
    const provisioned = provisionCapability(db, { projectId: project.id, candidate: candidate() });
    const verificationRunId = independentProof(db, provisioned);
    validateCapability(db, {
      id: provisioned.id,
      passed: true,
      reviewer: 'test-provider',
      evidence: 'independent validation passed',
      verificationRunId,
      artifact: artifact(),
    });
    recordCapabilityOutcome(db, {
      id: provisioned.id,
      success: false,
      evidence: 'first regression',
    });
    const degraded = recordCapabilityOutcome(db, {
      id: provisioned.id,
      success: false,
      evidence: 'second regression',
    });
    expect(degraded).toMatchObject({ status: 'degraded', failureCount: 2 });
    const retainedDegraded = recordCapabilityOutcome(db, {
      id: provisioned.id,
      success: true,
      evidence: 'recovery probe passed',
    });
    expect(retainedDegraded.status).toBe('degraded');
    const deprecated = deprecateCapability(db, provisioned.id, 'provider is no longer maintained');
    expect(deprecated.status).toBe('deprecated');
    expect(
      db
        .select()
        .from(capabilityEvents)
        .where(eq(capabilityEvents.capabilityId, provisioned.id))
        .all(),
    ).toHaveLength(6);
    expect(() =>
      db.delete(capabilityEvents).where(eq(capabilityEvents.capabilityId, provisioned.id)).run(),
    ).toThrow(/append-only/);
  });
});
