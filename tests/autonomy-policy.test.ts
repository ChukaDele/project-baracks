import { describe, expect, it } from 'vitest';
import { autonomyMetrics, classifyAutonomyBoundary } from '../src/supervisor/autonomy.js';
import { defaultProjectPolicy, type ProjectPolicy } from '../src/supervisor/policy.js';

function workshop(overrides: Partial<ProjectPolicy> = {}): ProjectPolicy {
  return {
    ...defaultProjectPolicy('workshop', '/tmp/workshop'),
    projectClass: 'workshop',
    trust: 'build',
    maxWorkers: 1,
    maxRunMinutes: 120,
    ownerApprovedBuild: true,
    ...overrides,
  };
}

describe('boundary-gated autonomy policy', () => {
  it.each([
    'project_read',
    'project_edit',
    'project_delete',
    'development_command',
    'dependency_install',
    'web_research',
    'branch_create',
    'ci_repair',
  ] as const)('classifies contained reversible %s as AUTO', (action) => {
    expect(classifyAutonomyBoundary(workshop(), action)).toBe('auto');
  });

  it('uses existing project policy for reversible external development actions', () => {
    expect(classifyAutonomyBoundary(workshop(), 'development_push')).toBe('policy_gated');
    expect(
      classifyAutonomyBoundary(workshop({ allowExternalWrites: true }), 'development_push'),
    ).toBe('auto');
    expect(classifyAutonomyBoundary(workshop({ allowExternalWrites: true }), 'pull_request')).toBe(
      'auto',
    );
  });

  it.each([
    'new_paid_spend',
    'credential_scope_change',
    'production_data_delete',
    'identity_security_change',
    'production_deploy',
    'unrelated_project_access',
  ] as const)('preserves the human-only boundary for %s', (action) => {
    expect(classifyAutonomyBoundary(workshop({ allowExternalWrites: true }), action)).toBe(
      'human_gated',
    );
  });

  it('reports intervention and recovery metrics from durable goal outcomes', () => {
    const base = {
      id: 'goal',
      project: 'workshop',
      repoPath: '/tmp/workshop',
      goal: 'finish',
      autonomous: true,
      preferredCoordinator: 'codex' as const,
      consecutiveFailures: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(
      autonomyMetrics([
        { ...base, id: 'a', status: 'done', cycle: 2 },
        { ...base, id: 'b', status: 'blocked', cycle: 1, ownerGate: 'Complete MFA.' },
      ]),
    ).toMatchObject({
      tasks: 2,
      humanInterventions: 1,
      completedWithoutInterruption: 1,
      completionWithoutInterruptionRate: 0.5,
      retryingTasks: 1,
      recoveredRetryingTasks: 1,
      blockerSelfResolutionRate: 1,
    });
  });
});
