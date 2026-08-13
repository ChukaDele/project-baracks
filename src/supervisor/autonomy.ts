import type { ProjectPolicy } from './policy.js';
import type { SupervisorGoal } from './state.js';

export const AUTONOMY_BOUNDARIES = ['auto', 'policy_gated', 'human_gated'] as const;
export type AutonomyBoundary = (typeof AUTONOMY_BOUNDARIES)[number];

export type AutonomousAction =
  | 'project_read'
  | 'project_edit'
  | 'project_delete'
  | 'development_command'
  | 'dependency_install'
  | 'web_research'
  | 'branch_create'
  | 'development_push'
  | 'pull_request'
  | 'ci_repair'
  | 'staging_deploy'
  | 'production_deploy'
  | 'merge_protected_branch'
  | 'new_paid_spend'
  | 'credential_scope_change'
  | 'production_data_delete'
  | 'identity_security_change'
  | 'unrelated_project_access';

const CONTAINED_AUTO = new Set<AutonomousAction>([
  'project_read',
  'project_edit',
  'project_delete',
  'development_command',
  'dependency_install',
  'web_research',
  'branch_create',
  'ci_repair',
]);

const EXTERNAL_POLICY = new Set<AutonomousAction>([
  'development_push',
  'pull_request',
  'staging_deploy',
  'merge_protected_branch',
]);

export function classifyAutonomyBoundary(
  policy: ProjectPolicy,
  action: AutonomousAction,
): AutonomyBoundary {
  if (
    action === 'new_paid_spend' ||
    action === 'credential_scope_change' ||
    action === 'production_data_delete' ||
    action === 'identity_security_change' ||
    action === 'production_deploy' ||
    action === 'unrelated_project_access'
  ) {
    return 'human_gated';
  }
  if (CONTAINED_AUTO.has(action)) return 'auto';
  if (EXTERNAL_POLICY.has(action)) {
    return policy.allowExternalWrites ? 'auto' : 'policy_gated';
  }
  return 'policy_gated';
}

export interface AutonomyMetrics {
  tasks: number;
  humanInterventions: number;
  completedWithoutInterruption: number;
  completionWithoutInterruptionRate: number;
  retryingTasks: number;
  recoveredRetryingTasks: number;
  blockerSelfResolutionRate: number;
}

export function autonomyMetrics(goals: readonly SupervisorGoal[]): AutonomyMetrics {
  const humanInterventions = goals.filter((goal) => Boolean(goal.ownerGate)).length;
  const completedWithoutInterruption = goals.filter(
    (goal) => goal.status === 'done' && !goal.ownerGate,
  ).length;
  const retrying = goals.filter((goal) => goal.cycle > 1);
  const recovered = retrying.filter((goal) => goal.status === 'done' && !goal.ownerGate);
  return {
    tasks: goals.length,
    humanInterventions,
    completedWithoutInterruption,
    completionWithoutInterruptionRate:
      goals.length === 0 ? 0 : completedWithoutInterruption / goals.length,
    retryingTasks: retrying.length,
    recoveredRetryingTasks: recovered.length,
    blockerSelfResolutionRate: retrying.length === 0 ? 0 : recovered.length / retrying.length,
  };
}
