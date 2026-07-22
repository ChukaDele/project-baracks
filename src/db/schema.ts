import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { TASK_STATUSES } from '../domain/lifecycle.js';

const isoNow = () => new Date().toISOString();

const id = () => text('id').primaryKey();
const createdAt = () => text('created_at').notNull().$defaultFn(isoNow);
const updatedAt = () => text('updated_at').notNull().$defaultFn(isoNow).$onUpdateFn(isoNow);

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull().unique(),
  repoPath: text('repo_path').notNull(),
  githubRepo: text('github_repo'),
  /** Full generic-project-adapter config (zod-validated JSON). */
  configJson: text('config_json').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roadmapItems = sqliteTable(
  'roadmap_items',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Stable row ID in the roadmap source (e.g. a Sheets row key). */
    stableRef: text('stable_ref').notNull(),
    title: text('title').notNull(),
    sourceStatus: text('source_status'),
    sourceJson: text('source_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roadmap_items_project_ref').on(t.projectId, t.stableRef)],
);

export const TASK_COMPLEXITIES = ['routine', 'bounded', 'complex', 'architectural'] as const;
export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** One roadmap item can have many engineering tasks. */
    roadmapItemId: text('roadmap_item_id').references(() => roadmapItems.id),
    /** Origin suggestion, if this task was approved from one. */
    suggestionId: text('suggestion_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** THE canonical task status. Never duplicated on any other table. */
    status: text('status', { enum: TASK_STATUSES }).notNull().default('draft'),
    complexity: text('complexity', { enum: TASK_COMPLEXITIES }).notNull().default('bounded'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tasks_project').on(t.projectId), index('tasks_roadmap_item').on(t.roadmapItemId)],
);

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => tasks.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('task_dependencies_pair').on(t.taskId, t.dependsOnTaskId)],
);

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const taskSuggestions = sqliteTable('task_suggestions', {
  id: id(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  roadmapItemId: text('roadmap_item_id').references(() => roadmapItems.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  rationale: text('rationale').notNull().default(''),
  suggestedBy: text('suggested_by').notNull().default('human'),
  /** Suggestion workflow status — distinct from the canonical task lifecycle. */
  status: text('status', { enum: SUGGESTION_STATUSES }).notNull().default('pending'),
  decidedAt: text('decided_at'),
  decisionNote: text('decision_note'),
  /** Set when approved: the Task materialised from this suggestion. */
  approvedTaskId: text('approved_task_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentProviders = sqliteTable('agent_providers', {
  id: id(),
  /** e.g. 'claude-code', 'codex' */
  name: text('name').notNull().unique(),
  executable: text('executable'),
  version: text('version'),
  lastDiscoveredAt: text('last_discovered_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const ROUTING_CLASSES = ['fable', 'opus', 'sonnet', 'codex', 'unknown'] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

export const MODEL_AVAILABILITIES = ['available', 'rate_limited', 'exhausted', 'unknown'] as const;
export type ModelAvailability = (typeof MODEL_AVAILABILITIES)[number];

export const BILLING_MODES = [
  'subscription_included',
  'usage_credits',
  'api_billing',
  'unknown',
] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const agentModels = sqliteTable(
  'agent_models',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => agentProviders.id),
    /** Provider-reported model identifier. Never hard-coded in logic. */
    modelRef: text('model_ref').notNull(),
    routingClass: text('routing_class', { enum: ROUTING_CLASSES }).notNull().default('unknown'),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(false),
    authenticated: integer('authenticated', { mode: 'boolean' }).notNull().default(false),
    availability: text('availability', { enum: MODEL_AVAILABILITIES }).notNull().default('unknown'),
    billingMode: text('billing_mode', { enum: BILLING_MODES }).notNull().default('unknown'),
    prohibited: integer('prohibited', { mode: 'boolean' }).notNull().default(false),
    prohibitedReason: text('prohibited_reason'),
    lastProbedAt: text('last_probed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_models_provider_ref').on(t.providerId, t.modelRef)],
);

export const RUN_PURPOSES = [
  'implementation',
  'verification',
  'review',
  'repair',
  'analysis',
] as const;
export type RunPurpose = (typeof RUN_PURPOSES)[number];

export const RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'checkpointed',
] as const;

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => agentProviders.id),
    modelId: text('model_id').references(() => agentModels.id),
    modelRef: text('model_ref').notNull(),
    purpose: text('purpose', { enum: RUN_PURPOSES }).notNull(),
    billingMode: text('billing_mode', { enum: BILLING_MODES }).notNull(),
    routingReason: text('routing_reason').notNull(),
    /** Non-null when review independence was compromised (same-provider review). */
    independenceLoss: text('independence_loss'),
    allowanceState: text('allowance_state'),
    worktreeId: text('worktree_id'),
    /** Execution status of this run — NOT the task's canonical status. */
    status: text('status', { enum: RUN_STATUSES }).notNull().default('pending'),
    sessionRef: text('session_ref'),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('agent_runs_task').on(t.taskId)],
);

/** Append-only. Rows are never updated or deleted (enforced by DB triggers). */
export const agentRunEvents = sqliteTable(
  'agent_run_events',
  {
    id: id(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('agent_run_events_run_seq').on(t.runId, t.seq)],
);

export const worktrees = sqliteTable('worktrees', {
  id: id(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  taskId: text('task_id').references(() => tasks.id),
  path: text('path').notNull(),
  branch: text('branch').notNull(),
  status: text('status', { enum: ['active', 'merged', 'removed'] })
    .notNull()
    .default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verificationRuns = sqliteTable('verification_runs', {
  id: id(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  agentRunId: text('agent_run_id').references(() => agentRuns.id),
  command: text('command').notNull(),
  status: text('status', { enum: ['pending', 'running', 'passed', 'failed'] })
    .notNull()
    .default('pending'),
  exitCode: integer('exit_code'),
  outputSummary: text('output_summary'),
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  createdAt: createdAt(),
});

export const reviewFindings = sqliteTable('review_findings', {
  id: id(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  agentRunId: text('agent_run_id').references(() => agentRuns.id),
  severity: text('severity', { enum: ['info', 'minor', 'major', 'critical'] }).notNull(),
  summary: text('summary').notNull(),
  detail: text('detail'),
  status: text('status', { enum: ['open', 'accepted', 'rejected', 'fixed'] })
    .notNull()
    .default('open'),
  /** True when the reviewing provider differed from the implementing provider. */
  independentReview: integer('independent_review', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const decisionRequests = sqliteTable('decision_requests', {
  id: id(),
  projectId: text('project_id').references(() => projects.id),
  taskId: text('task_id').references(() => tasks.id),
  /** Matches an approval category from the project config. */
  category: text('category').notNull(),
  question: text('question').notNull(),
  contextJson: text('context_json'),
  status: text('status', { enum: ['open', 'approved', 'rejected', 'expired'] })
    .notNull()
    .default('open'),
  resolution: text('resolution'),
  resolvedAt: text('resolved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const EVIDENCE_KINDS = [
  'test_result',
  'verification_run',
  'review',
  'artifact',
  'log',
  'other',
] as const;

export const evidence = sqliteTable(
  'evidence',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    ref: text('ref'),
    summary: text('summary').notNull(),
    dataJson: text('data_json'),
    createdAt: createdAt(),
  },
  (t) => [index('evidence_task').on(t.taskId)],
);

export const roadmapUpdates = sqliteTable('roadmap_updates', {
  id: id(),
  roadmapItemId: text('roadmap_item_id')
    .notNull()
    .references(() => roadmapItems.id),
  proposedByRunId: text('proposed_by_run_id').references(() => agentRuns.id),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  /** JSON map of column -> { old, new }. */
  changesJson: text('changes_json').notNull(),
  rationale: text('rationale').notNull(),
  /** JSON array of Evidence IDs backing this update. */
  evidenceIdsJson: text('evidence_ids_json').notNull().default('[]'),
  dryRunDiff: text('dry_run_diff'),
  status: text('status', { enum: ['proposed', 'applied', 'rejected', 'superseded'] })
    .notNull()
    .default('proposed'),
  appliedAt: text('applied_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const usageObservations = sqliteTable('usage_observations', {
  id: id(),
  providerId: text('provider_id')
    .notNull()
    .references(() => agentProviders.id),
  modelId: text('model_id').references(() => agentModels.id),
  agentRunId: text('agent_run_id').references(() => agentRuns.id),
  kind: text('kind', {
    enum: ['tokens', 'rate_limit', 'allowance', 'cost', 'exhaustion'],
  }).notNull(),
  dataJson: text('data_json').notNull().default('{}'),
  observedAt: text('observed_at').notNull().$defaultFn(isoNow),
  createdAt: createdAt(),
});
