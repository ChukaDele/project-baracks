import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addProject, getProjectByName } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import {
  capabilityEvents,
  capabilityRecords,
  capabilityVerificationArtifacts,
} from '../src/db/schema.js';
import { openDb } from '../src/db/client.js';
import {
  planCapabilityAcquisition,
  provisionCapability,
  validateDiscoveredCapability,
  capabilitySourceFingerprint,
  type CapabilityCandidate,
} from '../src/capabilities/registry.js';
import { discoverCapabilities } from '../src/capabilities/discovery.js';
import {
  isCapabilitySourceCurrent,
  runtimeAdapterRevision,
  verifyRuntimeAdapter,
} from '../src/capabilities/verifier.js';
import {
  coordinatorPrompt,
  recordReportedCapabilityUses,
  resolveGoalCapabilities,
} from '../src/supervisor/runtime.js';
import type { SupervisorGoal } from '../src/supervisor/state.js';

const roots: string[] = [];
let priorDbPath: string | undefined;

afterEach(() => {
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function candidate(key: string): CapabilityCandidate {
  return {
    key,
    name: key,
    description: `${key} local test capability`,
    type: 'adapter',
    operations: ['canonicalize-local-path'],
    riskLevel: 'low',
    costProfile: 'none',
    permissions: [],
    source: { kind: 'internal_adapter', reference: `${key} --read-only` },
    provenance: { discoveredBy: 'toolsmith-test-catalog', evidence: 'fixture' },
    preflight: {
      dependencyReviewed: true,
      permissionsReviewed: true,
      secretsSafe: true,
      telemetryReviewed: true,
      compatibilityChecked: true,
      smokeTestPassed: true,
      failureBehaviorPassed: true,
    },
  };
}

function setup(): { goal: SupervisorGoal; close(): void } {
  const root = mkdtempSync(join(tmpdir(), 'major-toolsmith-runtime-'));
  roots.push(root);
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  const { db, sqlite } = openDb();
  const repoPath = resolve(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  addProject(db, projectConfigSchema.parse({ name: 'toolsmith-runtime', repoPath }));
  sqlite.close();
  return {
    goal: {
      id: 'goal-toolsmith',
      project: 'toolsmith-runtime',
      repoPath,
      goal: 'Complete the original repository inspection task.',
      autonomous: false,
      status: 'active',
      preferredCoordinator: 'codex',
      cycle: 0,
      consecutiveFailures: 0,
      requiredOperations: ['canonicalize-local-path'],
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    },
    close() {
      // Every resolver call opens and closes its own connection.
    },
  };
}

describe('Toolsmith runtime loop', () => {
  it('reuses an existing verified capability without running discovery', () => {
    const { goal } = setup();
    const { db, sqlite } = openDb();
    const project = getProjectByName(db, goal.project);
    const discovered = discoverCapabilities({
      operation: 'canonicalize-local-path',
      repoPath: goal.repoPath,
    })[0]!;
    const provisioned = provisionCapability(db, {
      projectId: project.id,
      candidate: discovered.candidate,
    });
    validateDiscoveredCapability(db, {
      id: provisioned.id,
      repoPath: goal.repoPath,
    });
    sqlite.close();
    expect(() =>
      resolveGoalCapabilities(goal, {
        discover: () => {
          throw new Error('discovery should not run');
        },
        sourceCurrent: isCapabilitySourceCurrent,
      }),
    ).not.toThrow();
    expect(
      resolveGoalCapabilities(goal, {
        discover: () => [],
        sourceCurrent: isCapabilitySourceCurrent,
      }),
    ).toMatchObject({
      kind: 'ready',
      capabilities: [{ key: 'canonicalize-local-path' }],
    });
  });

  it('discovers, verifies, and returns control to the original goal', () => {
    const { goal } = setup();
    const resolved = resolveGoalCapabilities(goal);
    expect(resolved).toMatchObject({
      kind: 'ready',
      capabilities: [{ key: 'canonicalize-local-path' }],
    });
    if (resolved.kind !== 'ready') throw new Error('expected ready resolution');
    expect(coordinatorPrompt(goal, resolved.capabilities)).toContain(goal.goal);
    expect(coordinatorPrompt(goal, resolved.capabilities)).toContain('canonicalize-local-path');
    recordReportedCapabilityUses(resolved.capabilities, [
      { key: 'canonicalize-local-path', evidence: 'canonicalization returned the expected path' },
    ]);
    const { db, sqlite } = openDb();
    expect(db.select().from(capabilityVerificationArtifacts).all()).toMatchObject([
      {
        operation: 'canonicalize-local-path',
        status: 'passed',
        validator: 'toolsmith-internal-verifier-v1',
      },
    ]);
    expect(db.select().from(capabilityEvents).all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'reported_use' })]),
    );
    expect(db.select().from(capabilityRecords).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'canonicalize-local-path', successCount: 0 }),
      ]),
    );
    sqlite.close();
  });

  it('tries a second safe candidate after the first validation fails', () => {
    const { goal } = setup();
    const resolved = resolveGoalCapabilities(goal, {
      discover: () => [
        { candidate: candidate('first-status') },
        ...discoverCapabilities({ operation: 'canonicalize-local-path', repoPath: goal.repoPath }),
      ],
      sourceCurrent: isCapabilitySourceCurrent,
    });
    expect(resolved).toMatchObject({
      kind: 'ready',
      capabilities: [{ key: 'canonicalize-local-path' }],
    });
    const { db, sqlite } = openDb();
    expect(db.select().from(capabilityRecords).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'first-status', status: 'blocked' }),
        expect.objectContaining({ key: 'canonicalize-local-path', status: 'validated' }),
      ]),
    );
    sqlite.close();
  });

  it('blocks once when discovery finds only an unsafe candidate', () => {
    const { goal } = setup();
    const unsafe = { candidate: { ...candidate('unsafe-status'), riskLevel: 'high' as const } };
    expect(
      resolveGoalCapabilities(goal, {
        discover: () => [unsafe],
        sourceCurrent: isCapabilitySourceCurrent,
      }),
    ).toMatchObject({
      kind: 'checkpoint',
      reason: expect.stringContaining('high-risk'),
    });
  });

  it('does not reuse verification after a material source fingerprint change', () => {
    const { goal } = setup();
    const resolved = resolveGoalCapabilities(goal);
    if (resolved.kind !== 'ready') throw new Error('expected ready resolution');
    const { db, sqlite } = openDb();
    db.update(capabilityRecords)
      .set({ sourceFingerprint: 'changed-source-fingerprint' })
      .where(eq(capabilityRecords.id, resolved.capabilities[0]!.id))
      .run();
    expect(
      planCapabilityAcquisition(db, {
        projectId: resolved.capabilities[0]!.projectId,
        operation: 'canonicalize-local-path',
        candidates: [],
      }),
    ).toMatchObject({ kind: 'blocked' });
    sqlite.close();
  });

  it('revalidates when the stored internal-adapter revision becomes stale', () => {
    const { goal } = setup();
    const first = resolveGoalCapabilities(goal);
    if (first.kind !== 'ready') throw new Error('expected initial resolution');
    const { db, sqlite } = openDb();
    const prior = first.capabilities[0]!;
    const staleSource = { ...prior.source, revision: '0'.repeat(64) };
    db.update(capabilityRecords)
      .set({
        sourceJson: JSON.stringify(staleSource),
        sourceFingerprint: capabilitySourceFingerprint(staleSource),
      })
      .where(eq(capabilityRecords.id, prior.id))
      .run();
    sqlite.close();
    const second = resolveGoalCapabilities(goal);
    if (second.kind !== 'ready') throw new Error('expected revalidation');
    expect(second.capabilities[0]!.id).toBe(first.capabilities[0]!.id);
    expect(second.capabilities[0]!.source.revision).toBe(runtimeAdapterRevision());
    expect(second.capabilities[0]!.verificationArtifactId).not.toBe(
      first.capabilities[0]!.verificationArtifactId,
    );
  });

  it('discovers an existing read-only internal adapter without package installation', () => {
    const results = discoverCapabilities({
      operation: 'canonicalize-local-path',
      repoPath: process.cwd(),
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.candidate.key).toBe('canonicalize-local-path');
    expect(verifyRuntimeAdapter(process.cwd())).toMatchObject({
      passed: true,
      operation: 'canonicalize-local-path',
    });
  });
});
