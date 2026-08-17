import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { TASK_STATUSES } from '../domain/lifecycle.js';

const isoNow = () => new Date().toISOString();

const id = () => text('id').primaryKey();
const createdAt = () => text('created_at').notNull().$defaultFn(isoNow);
const updatedAt = () => text('updated_at').notNull().$defaultFn(isoNow).$onUpdateFn(isoNow);

/** DB-level CHECK that a column only holds one of the given values. */
const enumCheck = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`"${column}" IN (${values.map((v) => `'${v}'`).join(', ')})`));

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
  (t) => [
    uniqueIndex('roadmap_items_project_ref').on(t.projectId, t.stableRef),
    // Composite target for same-project foreign keys from tasks/suggestions.
    uniqueIndex('roadmap_items_id_project').on(t.id, t.projectId),
  ],
);

export const TASK_COMPLEXITIES = ['routine', 'bounded', 'complex', 'architectural'] as const;
export type TaskComplexity = (typeof TASK_COMPLEXITIES)[number];

/** Statuses a persisted task row may hold: everything except the conceptual
 * 'suggested' entry state, which only ever exists as a TaskSuggestion row. */
export const PERSISTED_TASK_STATUSES = TASK_STATUSES.filter((s) => s !== 'suggested');

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** One roadmap item can have many engineering tasks. */
    roadmapItemId: text('roadmap_item_id'),
    /** Origin suggestion, if this task was approved from one. */
    suggestionId: text('suggestion_id').references((): AnySQLiteColumn => taskSuggestions.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** THE canonical task status. Never duplicated on any other table. */
    status: text('status', { enum: TASK_STATUSES }).notNull().default('draft'),
    complexity: text('complexity', { enum: TASK_COMPLEXITIES }).notNull().default('bounded'),
    /** Optimistic-concurrency version; bumped on every guarded transition. */
    version: integer('version').notNull().default(0),
    /** Fence that authorised the latest worker-owned status transition. */
    mutationClaimId: text('mutation_claim_id').references((): AnySQLiteColumn => taskClaims.id),
    mutationWorkerId: text('mutation_worker_id'),
    /** Optional task-specific completion criteria (JSON, see domain/completion). */
    completionCriteriaJson: text('completion_criteria_json'),
    /** Immutable criteria captured at the first dispatch to queued. */
    completionCriteriaSnapshotJson: text('completion_criteria_snapshot_json'),
    completionCriteriaLockedAt: text('completion_criteria_locked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_project').on(t.projectId),
    index('tasks_roadmap_item').on(t.roadmapItemId),
    index('tasks_status').on(t.status),
    // One approved task per suggestion, enforced by the DB.
    uniqueIndex('tasks_suggestion_unique')
      .on(t.suggestionId)
      .where(sql`suggestion_id IS NOT NULL`),
    // A task's roadmap item must belong to the task's own project.
    foreignKey({
      name: 'tasks_roadmap_item_project_fk',
      columns: [t.roadmapItemId, t.projectId],
      foreignColumns: [roadmapItems.id, roadmapItems.projectId],
    }),
    enumCheck('tasks_status_persistable', 'status', PERSISTED_TASK_STATUSES),
    enumCheck('tasks_complexity_valid', 'complexity', TASK_COMPLEXITIES),
  ],
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
  (t) => [
    uniqueIndex('task_dependencies_pair').on(t.taskId, t.dependsOnTaskId),
    check('task_dependencies_not_self', sql`task_id <> depends_on_task_id`),
  ],
);

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const SUGGESTION_SOURCE_TYPES = [
  'human',
  'agent',
  'test_failure',
  'review_finding',
  'evidence',
  'run',
  'task',
] as const;
export type SuggestionSourceType = (typeof SUGGESTION_SOURCE_TYPES)[number];

export const taskSuggestions = sqliteTable(
  'task_suggestions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    roadmapItemId: text('roadmap_item_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    rationale: text('rationale').notNull().default(''),
    suggestedBy: text('suggested_by').notNull().default('human'),
    /** Structured provenance: what kind of thing produced this suggestion. */
    sourceType: text('source_type', { enum: SUGGESTION_SOURCE_TYPES }).notNull().default('human'),
    /** Id of the source record (finding/run/evidence/task) when applicable. */
    sourceRef: text('source_ref'),
    /** Normalised fingerprint of the suggestion's scope, for deduplication. */
    scopeFingerprint: text('scope_fingerprint').notNull(),
    /** Suggestion workflow status — distinct from the canonical task lifecycle. */
    status: text('status', { enum: SUGGESTION_STATUSES }).notNull().default('pending'),
    decidedAt: text('decided_at'),
    decisionNote: text('decision_note'),
    /** Set when approved: the Task materialised from this suggestion. */
    approvedTaskId: text('approved_task_id').references((): AnySQLiteColumn => tasks.id),
    /** A later suggestion explicitly superseding this (rejected) one. */
    supersededById: text('superseded_by_id').references((): AnySQLiteColumn => taskSuggestions.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('task_suggestions_project_fingerprint').on(t.projectId, t.scopeFingerprint),
    // Only one live (pending) suggestion per scope per project.
    uniqueIndex('task_suggestions_pending_fingerprint')
      .on(t.projectId, t.scopeFingerprint)
      .where(sql`status = 'pending'`),
    // A task can be materialised from at most one suggestion (and vice versa).
    uniqueIndex('task_suggestions_approved_task')
      .on(t.approvedTaskId)
      .where(sql`approved_task_id IS NOT NULL`),
    foreignKey({
      name: 'task_suggestions_roadmap_item_project_fk',
      columns: [t.roadmapItemId, t.projectId],
      foreignColumns: [roadmapItems.id, roadmapItems.projectId],
    }),
    enumCheck('task_suggestions_status_valid', 'status', SUGGESTION_STATUSES),
    enumCheck('task_suggestions_source_type_valid', 'source_type', SUGGESTION_SOURCE_TYPES),
    check(
      'task_suggestions_approved_has_task',
      sql`(status = 'approved') = (approved_task_id IS NOT NULL)`,
    ),
    check(
      'task_suggestions_source_ref_present',
      sql`source_type IN ('human', 'agent') OR source_ref IS NOT NULL`,
    ),
  ],
);

export const agentProviders = sqliteTable(
  'agent_providers',
  {
    id: id(),
    /** e.g. 'claude-code', 'codex' */
    name: text('name').notNull(),
    /** Distinguishes multiple authenticated accounts/subscriptions for the
     * same provider CLI (e.g. two independently logged-in Codex accounts).
     * 'default' when the provider has only one configured account; existing
     * single-account rows and callers are unaffected. */
    accountLabel: text('account_label').notNull().default('default'),
    executable: text('executable'),
    version: text('version'),
    /** SHA-256 of the currently-imported credential's bytes, never the bytes
     * themselves. Lets `major provider connect` detect "the host credential
     * changed since we last imported it" (a manual account swap) without
     * ever persisting secret material. Null until a credential is imported. */
    credentialFingerprint: text('credential_fingerprint'),
    lastDiscoveredAt: text('last_discovered_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_providers_name_account').on(t.name, t.accountLabel)],
);

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
    /** When exhausted/rate-limited: no re-probe or retry before this time. */
    nextProbeAt: text('next_probe_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agent_models_provider_ref').on(t.providerId, t.modelRef),
    enumCheck('agent_models_routing_class_valid', 'routing_class', ROUTING_CLASSES),
    enumCheck('agent_models_availability_valid', 'availability', MODEL_AVAILABILITIES),
    enumCheck('agent_models_billing_mode_valid', 'billing_mode', BILLING_MODES),
  ],
);

/** One observation of provider/model state: where knowledge came from and how
 * strong it is. Append-only (trigger-enforced). */
export const OBSERVATION_SOURCES = ['registry', 'cli', 'probe', 'run_outcome', 'human'] as const;
export const OBSERVATION_CONFIDENCES = ['configured', 'inferred', 'observed'] as const;

export const discoveryObservations = sqliteTable(
  'discovery_observations',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => agentProviders.id),
    modelId: text('model_id').references(() => agentModels.id),
    /** JSON of the observed state fields (visibility, availability, billing…). */
    observedJson: text('observed_json').notNull(),
    source: text('source', { enum: OBSERVATION_SOURCES }).notNull(),
    confidence: text('confidence', { enum: OBSERVATION_CONFIDENCES }).notNull(),
    observedAt: text('observed_at').notNull().$defaultFn(isoNow),
    createdAt: createdAt(),
  },
  (t) => [
    index('discovery_observations_model').on(t.modelId),
    enumCheck('discovery_observations_source_valid', 'source', OBSERVATION_SOURCES),
    enumCheck('discovery_observations_confidence_valid', 'confidence', OBSERVATION_CONFIDENCES),
  ],
);

/** Project-scoped tools, adapters and providers that Toolsmith has evaluated.
 * These are distinct from the immutable build-capability gates in
 * security/capabilities.ts: a record says what a project may use, never what
 * authority the Major runtime grants. */
export const CAPABILITY_TYPES = [
  'local_tool',
  'skill',
  'mcp',
  'api',
  'cli',
  'library',
  'open_source',
  'adapter',
  'browser',
] as const;
export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

export const CAPABILITY_STATUSES = [
  'candidate',
  'provisional',
  'validated',
  'preferred',
  'degraded',
  'deprecated',
  'blocked',
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_VALIDATION_STATES = [
  'not_started',
  'preflight_passed',
  'capability_verified',
  'independently_validated',
  'failed',
] as const;
export type CapabilityValidationState = (typeof CAPABILITY_VALIDATION_STATES)[number];

export const capabilityRecords = sqliteTable(
  'capability_records',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type', { enum: CAPABILITY_TYPES }).notNull(),
    operationsJson: text('operations_json').notNull(),
    riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] }).notNull(),
    sourceJson: text('source_json').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    provenanceJson: text('provenance_json').notNull(),
    verificationArtifactId: text('verification_artifact_id'),
    status: text('status', { enum: CAPABILITY_STATUSES }).notNull().default('candidate'),
    validationState: text('validation_state', { enum: CAPABILITY_VALIDATION_STATES })
      .notNull()
      .default('not_started'),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastUsedAt: text('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('capability_records_project_key').on(t.projectId, t.key),
    index('capability_records_project_status').on(t.projectId, t.status),
    enumCheck('capability_records_type_valid', 'type', CAPABILITY_TYPES),
    enumCheck('capability_records_status_valid', 'status', CAPABILITY_STATUSES),
    enumCheck(
      'capability_records_validation_valid',
      'validation_state',
      CAPABILITY_VALIDATION_STATES,
    ),
    check('capability_records_counts_non_negative', sql`success_count >= 0 AND failure_count >= 0`),
  ],
);

/** Compact, capability-specific verification provenance. Full logs stay with
 * the verifier; this record contains only the facts needed to revalidate. */
export const capabilityVerificationArtifacts = sqliteTable(
  'capability_verification_artifacts',
  {
    id: id(),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilityRecords.id),
    sourceFingerprint: text('source_fingerprint').notNull(),
    operation: text('operation').notNull(),
    fixtureJson: text('fixture_json').notNull(),
    expectedJson: text('expected_json').notNull(),
    actualJson: text('actual_json').notNull(),
    validator: text('validator').notNull(),
    environmentJson: text('environment_json').notNull(),
    securityJson: text('security_json').notNull(),
    status: text('status', { enum: ['passed', 'failed'] }).notNull(),
    verificationRunId: text('verification_run_id').references(() => verificationRuns.id),
    validationSubject: text('validation_subject').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('capability_verification_artifacts_capability').on(t.capabilityId),
    enumCheck('capability_verification_artifacts_status_valid', 'status', ['passed', 'failed']),
  ],
);

/** Append-only evidence for Toolsmith lifecycle decisions and real outcomes. */
export const capabilityEvents = sqliteTable(
  'capability_events',
  {
    id: id(),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilityRecords.id),
    kind: text('kind', {
      enum: [
        'provisioned',
        'validated',
        'validation_failed',
        'outcome',
        'reported_use',
        'deprecated',
        'preferred',
      ],
    }).notNull(),
    evidenceJson: text('evidence_json').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('capability_events_capability').on(t.capabilityId),
    enumCheck('capability_events_kind_valid', 'kind', [
      'provisioned',
      'validated',
      'validation_failed',
      'outcome',
      'reported_use',
      'deprecated',
      'preferred',
    ]),
  ],
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

export const CLAIM_STATUSES = ['active', 'completed', 'released', 'expired'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Durable execution claims: which worker holds which task, under a lease.
 * Attempt history is immutable (trigger-enforced); at most one active claim
 * per task (partial unique index).
 */
export const taskClaims = sqliteTable(
  'task_claims',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    /** Durable worker identity (host+pid+uuid or similar). */
    workerId: text('worker_id').notNull(),
    /** Monotonic attempt number per task; history is append-only. */
    attempt: integer('attempt').notNull(),
    status: text('status', { enum: CLAIM_STATUSES }).notNull().default('active'),
    leaseExpiresAt: text('lease_expires_at').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    /** Why the claim left 'active' (completed, cancelled, lease expired…). */
    outcomeReason: text('outcome_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('task_claims_task_attempt').on(t.taskId, t.attempt),
    uniqueIndex('task_claims_one_active')
      .on(t.taskId)
      .where(sql`status = 'active'`),
    index('task_claims_status').on(t.status),
    enumCheck('task_claims_status_valid', 'status', CLAIM_STATUSES),
    check('task_claims_attempt_positive', sql`attempt >= 1`),
  ],
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    /** The claim under which this run executes. */
    claimId: text('claim_id').references(() => taskClaims.id),
    /** Worker identity paired with claimId at the durable insert boundary. */
    claimWorkerId: text('claim_worker_id'),
    providerId: text('provider_id')
      .notNull()
      .references(() => agentProviders.id),
    modelId: text('model_id').references(() => agentModels.id),
    modelRef: text('model_ref').notNull(),
    purpose: text('purpose', { enum: RUN_PURPOSES }).notNull(),
    billingMode: text('billing_mode', { enum: BILLING_MODES }).notNull(),
    routingReason: text('routing_reason').notNull(),
    /** Approved DecisionRequest authorising paid usage, when billing is paid. */
    paidUsageDecisionId: text('paid_usage_decision_id').references(
      (): AnySQLiteColumn => decisionRequests.id,
    ),
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
  (t) => [
    index('agent_runs_task').on(t.taskId),
    // Composite target so verification/review rows must cite a run of the SAME task.
    uniqueIndex('agent_runs_id_task').on(t.id, t.taskId),
    enumCheck('agent_runs_purpose_valid', 'purpose', RUN_PURPOSES),
    enumCheck('agent_runs_status_valid', 'status', RUN_STATUSES),
    enumCheck('agent_runs_billing_mode_valid', 'billing_mode', BILLING_MODES),
    // Paid billing modes require an authorising DecisionRequest reference.
    check(
      'agent_runs_paid_requires_decision',
      sql`billing_mode NOT IN ('usage_credits', 'api_billing') OR paid_usage_decision_id IS NOT NULL`,
    ),
  ],
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
    /** Idempotency key for at-least-once delivery from providers. */
    eventKey: text('event_key'),
    /** SHA-256 of (type + canonical payload); duplicate detection identity. */
    payloadHash: text('payload_hash').notNull(),
    /** Redacted BEFORE persistence — secrets never reach this column. */
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_run_events_run_seq').on(t.runId, t.seq),
    uniqueIndex('agent_run_events_run_key')
      .on(t.runId, t.eventKey)
      .where(sql`event_key IS NOT NULL`),
  ],
);

export const worktrees = sqliteTable(
  'worktrees',
  {
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
  },
  () => [enumCheck('worktrees_status_valid', 'status', ['active', 'merged', 'removed'])],
);

export const VERIFICATION_STATUSES = ['pending', 'running', 'passed', 'failed'] as const;

export const verificationRuns = sqliteTable(
  'verification_runs',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    agentRunId: text('agent_run_id'),
    command: text('command').notNull(),
    status: text('status', { enum: VERIFICATION_STATUSES }).notNull().default('pending'),
    exitCode: integer('exit_code'),
    outputSummary: text('output_summary'),
    /** Immutable capability/version/operation binding when this run validates a capability. */
    validationSubject: text('validation_subject'),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('verification_runs_task').on(t.taskId),
    foreignKey({
      name: 'verification_runs_run_same_task_fk',
      columns: [t.agentRunId, t.taskId],
      foreignColumns: [agentRuns.id, agentRuns.taskId],
    }),
    enumCheck('verification_runs_status_valid', 'status', VERIFICATION_STATUSES),
  ],
);

export const FINDING_SEVERITIES = ['info', 'minor', 'major', 'critical'] as const;
export const FINDING_STATUSES = ['open', 'accepted', 'rejected', 'fixed'] as const;

export const reviewFindings = sqliteTable(
  'review_findings',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    agentRunId: text('agent_run_id'),
    /** Run whose live fence authorised resolution of this finding. */
    resolutionRunId: text('resolution_run_id'),
    severity: text('severity', { enum: FINDING_SEVERITIES }).notNull(),
    summary: text('summary').notNull(),
    detail: text('detail'),
    status: text('status', { enum: FINDING_STATUSES }).notNull().default('open'),
    /** True when the reviewing provider differed from the implementing provider. */
    independentReview: integer('independent_review', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('review_findings_task').on(t.taskId),
    foreignKey({
      name: 'review_findings_run_same_task_fk',
      columns: [t.agentRunId, t.taskId],
      foreignColumns: [agentRuns.id, agentRuns.taskId],
    }),
    enumCheck('review_findings_severity_valid', 'severity', FINDING_SEVERITIES),
    enumCheck('review_findings_status_valid', 'status', FINDING_STATUSES),
  ],
);

export const DECISION_STATUSES = ['open', 'approved', 'rejected', 'expired'] as const;

export const decisionRequests = sqliteTable(
  'decision_requests',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id),
    taskId: text('task_id').references(() => tasks.id),
    /** Matches an approval category from the project config. */
    category: text('category').notNull(),
    question: text('question').notNull(),
    contextJson: text('context_json'),
    status: text('status', { enum: DECISION_STATUSES }).notNull().default('open'),
    resolution: text('resolution'),
    resolvedAt: text('resolved_at'),
    /** When set, the approval is invalid at/after this instant (ISO 8601 UTC).
     * Mandatory for paid_usage approvals (enforced at the DB boundary). */
    expiresAt: text('expires_at'),
    /** The single run that consumed this approval. A paid approval authorises
     * exactly one run: once stamped, it can never authorise another. */
    consumedByRunId: text('consumed_by_run_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('decision_requests_status_valid', 'status', DECISION_STATUSES),
    check(
      'decision_requests_resolved_has_time',
      sql`status NOT IN ('approved', 'rejected') OR resolved_at IS NOT NULL`,
    ),
    // At most one run may consume any approval (single-use, DB-backed).
    uniqueIndex('decision_requests_consumed_by_run')
      .on(t.consumedByRunId)
      .where(sql`consumed_by_run_id IS NOT NULL`),
  ],
);

/** Single-use consumption ledger for provider action approvals. */
export const providerActionConsumptions = sqliteTable('provider_action_consumptions', {
  id: id(),
  decisionId: text('decision_id')
    .notNull()
    .unique()
    .references(() => decisionRequests.id),
  consumerId: text('consumer_id').notNull().unique(),
  createdAt: createdAt(),
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
    /** Worker run that produced this evidence, when worker-owned. */
    agentRunId: text('agent_run_id'),
    kind: text('kind', { enum: EVIDENCE_KINDS }).notNull(),
    ref: text('ref'),
    summary: text('summary').notNull(),
    dataJson: text('data_json'),
    createdAt: createdAt(),
  },
  (t) => [
    index('evidence_task').on(t.taskId),
    enumCheck('evidence_kind_valid', 'kind', EVIDENCE_KINDS),
    // Linked-record kinds must carry the reference; triggers additionally
    // verify the referenced row exists and belongs to the same task.
    check(
      'evidence_linked_kinds_have_ref',
      sql`kind NOT IN ('verification_run', 'review') OR ref IS NOT NULL`,
    ),
  ],
);

export const ROADMAP_UPDATE_STATUSES = [
  'proposed',
  'applying',
  'applied',
  'rejected',
  'superseded',
] as const;

export const roadmapUpdates = sqliteTable(
  'roadmap_updates',
  {
    id: id(),
    roadmapItemId: text('roadmap_item_id')
      .notNull()
      .references(() => roadmapItems.id),
    proposedByRunId: text('proposed_by_run_id').references(() => agentRuns.id),
    /** Must embed the canonical payload hash (see roadmap/canonical.ts). */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** SHA-256 over the canonicalised change set. */
    payloadHash: text('payload_hash').notNull(),
    /** Roadmap-source revision observed at dry-run time. */
    sourceRevision: text('source_revision'),
    /** JSON map of column -> { old, new }. */
    changesJson: text('changes_json').notNull(),
    rationale: text('rationale').notNull(),
    /** JSON array of Evidence IDs backing this update. */
    evidenceIdsJson: text('evidence_ids_json').notNull().default('[]'),
    dryRunDiff: text('dry_run_diff'),
    dryRunAt: text('dry_run_at'),
    status: text('status', { enum: ROADMAP_UPDATE_STATUSES }).notNull().default('proposed'),
    /** Fencing token for the crash-consistent apply protocol: exactly one
     * worker claims 'applying' under a fresh attempt id and only that
     * attempt may settle the update. */
    applyAttemptId: text('apply_attempt_id'),
    applyStartedAt: text('apply_started_at'),
    /** Worker that owns the in-flight apply attempt. */
    applyWorkerId: text('apply_worker_id'),
    /** The apply attempt's lease. Reconciliation may only reclaim an
     * 'applying' row after this lapses — and only after confirming, via the
     * adapter idempotency record, that the external write did not land. */
    applyLeaseExpiresAt: text('apply_lease_expires_at'),
    appliedAt: text('applied_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    enumCheck('roadmap_updates_status_valid', 'status', ROADMAP_UPDATE_STATUSES),
    // Applying requires the exact prior dry run to be on record.
    check(
      'roadmap_updates_applied_needs_dry_run',
      sql`status <> 'applied' OR (applied_at IS NOT NULL AND dry_run_diff IS NOT NULL AND dry_run_at IS NOT NULL)`,
    ),
    // An in-flight apply is always attributable to a claimed attempt.
    check(
      'roadmap_updates_applying_has_attempt',
      sql`status <> 'applying' OR (apply_attempt_id IS NOT NULL AND apply_started_at IS NOT NULL)`,
    ),
  ],
);

/** Enforces the supported single-host roadmap mutation model durably. */
export const roadmapRuntimeHosts = sqliteTable('roadmap_runtime_hosts', {
  id: text('id').primaryKey(),
  hostId: text('host_id').notNull(),
  createdAt: createdAt(),
});

export const usageObservations = sqliteTable(
  'usage_observations',
  {
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
  },
  () => [
    enumCheck('usage_observations_kind_valid', 'kind', [
      'tokens',
      'rate_limit',
      'allowance',
      'cost',
      'exhaustion',
    ]),
  ],
);

/** A persisted routing checkpoint: the preferred model was unavailable or
 * only paid options remained, and Major paused instead of proceeding. */
export const routingCheckpoints = sqliteTable(
  'routing_checkpoints',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    purpose: text('purpose', { enum: RUN_PURPOSES }).notNull(),
    reason: text('reason').notNull(),
    /** Paid candidates that existed but were not authorised (JSON array). */
    paidOptionsJson: text('paid_options_json').notNull().default('[]'),
    createdAt: createdAt(),
  },
  (t) => [
    index('routing_checkpoints_task').on(t.taskId),
    enumCheck('routing_checkpoints_purpose_valid', 'purpose', RUN_PURPOSES),
  ],
);

/** Append-only audit trail of every execution-gateway policy decision. */
export const executionPolicyDecisions = sqliteTable('execution_policy_decisions', {
  id: id(),
  kind: text('kind', { enum: ['execute', 'probe'] }).notNull(),
  allowed: integer('allowed', { mode: 'boolean' }).notNull(),
  executable: text('executable').notNull(),
  /** Redacted argv (JSON array). */
  argvJson: text('argv_json').notNull(),
  cwd: text('cwd'),
  reason: text('reason').notNull(),
  strippedEnvJson: text('stripped_env_json').notNull().default('[]'),
  authorizedEnvJson: text('authorized_env_json').notNull().default('[]'),
  envDecisionId: text('env_decision_id'),
  at: text('at').notNull(),
  createdAt: createdAt(),
});

export const VALIDATION_LEASE_STATUSES = [
  'issued',
  'admitted',
  'running',
  'validating',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;
export type ValidationLeaseStatus = (typeof VALIDATION_LEASE_STATUSES)[number];

/**
 * One-use release-validation authority. This is deliberately separate from
 * task claims and resource leases: those fence task mutations and capacity,
 * while this row admits one immutable validation request while M1 is closed.
 */
export const validationLeases = sqliteTable(
  'validation_leases',
  {
    id: id(),
    activationSlot: integer('activation_slot').notNull().default(1),
    tokenHash: text('token_hash').notNull(),
    authorityLeaseId: text('authority_lease_id').notNull(),
    authorityArtifactDigest: text('authority_artifact_digest').notNull(),
    authorityValidationNonce: text('authority_validation_nonce').notNull(),
    authorityExpiresAt: text('authority_expires_at').notNull(),
    releaseRepository: text('release_repository').notNull(),
    releaseSourceCheckout: text('release_source_checkout').notNull(),
    releaseRoot: text('release_root').notNull(),
    releaseBranch: text('release_branch').notNull(),
    releaseSha: text('release_sha').notNull(),
    releaseTreeHash: text('release_tree_hash').notNull(),
    releaseManifestHash: text('release_manifest_hash').notNull(),
    provider: text('provider').notNull(),
    projectIdentityHash: text('project_identity_hash').notNull(),
    projectRootHash: text('project_root_hash').notNull(),
    caseId: text('case_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    expectedEvidenceHash: text('expected_evidence_hash').notNull(),
    expectedExecutionStatus: text('expected_execution_status', {
      enum: ['succeeded', 'cancelled'],
    }).notNull(),
    workerId: text('worker_id').notNull(),
    processNonce: text('process_nonce').notNull(),
    resourceLeaseId: text('resource_lease_id'),
    predecessorLeaseId: text('predecessor_lease_id'),
    status: text('status', { enum: VALIDATION_LEASE_STATUSES }).notNull().default('issued'),
    expiresAt: text('expires_at').notNull(),
    admittedAt: text('admitted_at'),
    terminalAt: text('terminal_at'),
    runId: text('run_id'),
    outcomeReason: text('outcome_reason'),
    evidenceHash: text('evidence_hash'),
    evidenceJson: text('evidence_json'),
    resultSessionRefHash: text('result_session_ref_hash'),
    resultModel: text('result_model'),
    resultEventHash: text('result_event_hash'),
    resultEventCount: integer('result_event_count'),
    resultWorkspaceHash: text('result_workspace_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('validation_leases_token_hash').on(t.tokenHash),
    uniqueIndex('validation_leases_authority_request').on(
      t.authorityArtifactDigest,
      t.requestDigest,
    ),
    uniqueIndex('validation_leases_one_active')
      .on(t.activationSlot)
      .where(sql`status IN ('issued', 'admitted', 'running', 'validating')`),
    index('validation_leases_release_sha').on(t.releaseSha),
    index('validation_leases_status').on(t.status),
    enumCheck('validation_leases_status_valid', 'status', VALIDATION_LEASE_STATUSES),
    check(
      'validation_leases_sha_valid',
      sql`length(release_sha) = 40 AND release_sha NOT GLOB '*[^0-9a-f]*'`,
    ),
    check('validation_leases_activation_slot', sql`activation_slot = 1`),
    check(
      'validation_leases_digest_valid',
      sql`
      length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
      AND length(authority_artifact_digest) = 64 AND authority_artifact_digest NOT GLOB '*[^0-9a-f]*'
      AND length(authority_validation_nonce) = 36 AND authority_validation_nonce NOT GLOB '*[^0-9a-f-]*'
      AND length(release_manifest_hash) = 64 AND release_manifest_hash NOT GLOB '*[^0-9a-f]*'
      AND length(release_tree_hash) = 64 AND release_tree_hash NOT GLOB '*[^0-9a-f]*'
      AND length(project_identity_hash) = 64 AND project_identity_hash NOT GLOB '*[^0-9a-f]*'
      AND length(project_root_hash) = 64 AND project_root_hash NOT GLOB '*[^0-9a-f]*'
      AND length(request_digest) = 64 AND request_digest NOT GLOB '*[^0-9a-f]*'
      AND length(expected_evidence_hash) = 64 AND expected_evidence_hash NOT GLOB '*[^0-9a-f]*'
    `,
    ),
  ],
);
