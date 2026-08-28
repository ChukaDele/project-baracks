import type Database from 'better-sqlite3';

export interface ShaperTelemetryRow {
  recordType: 'run';
  day: string;
  runId: string;
  project: string;
  taskId: string;
  taskStatus: string;
  /** Major does not persist a separate task-family field yet. */
  taskFamily: string | null;
  runPurpose: string;
  worker: string | null;
  provider: string;
  /** This is a configured account label, never a credential or fingerprint. */
  providerAccount: string | null;
  model: string;
  billingMode: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  costCurrency: string | null;
  /** Major does not persist a cache/reuse outcome per run yet. */
  cacheReuseStatus: string | null;
  retryCount: number | null;
  /** Major does not persist a run-level concurrency gauge yet. */
  concurrency: number | null;
  /** Major does not persist queue entry/wait timestamps yet. */
  queueWaitSeconds: number | null;
  resultStatus: string;
  /** Free-form failure text is intentionally not exported. */
  failureReason: string | null;
  approvalState: string | null;
  /** Only approval state is currently attributable to a run. */
  humanInterventionState: string | null;
  ciTestOutcome: string | null;
  /** Major has no durable numeric evaluator score on the run row yet. */
  qualityScore: number | null;
  /** Skill invocation names are not currently persisted on runs. */
  skillsInvoked: string | null;
  /** GBrain read/write counts are not currently persisted on runs. */
  gbrainReads: number | null;
  gbrainWrites: number | null;
  eventCount: number;
}

export interface ShaperReadOptions {
  days?: number;
  project?: string;
  provider?: string;
  runPurpose?: string;
  limit?: number;
  /** Test seam and explicit report cutoff. Defaults to the current instant. */
  asOf?: string;
}

export interface ShaperCommandCentreRow {
  metric: 'task_status' | 'run_status';
  status: string;
  count: number;
  latestAt: string | null;
}

interface RawTelemetryRow {
  day: string;
  runId: string;
  project: string;
  taskId: string;
  taskStatus: string;
  runPurpose: string;
  worker: string | null;
  provider: string;
  providerAccount: string | null;
  model: string;
  billingMode: string;
  startedAt: string | null;
  endedAt: string | null;
  resultStatus: string;
  approvalState: string | null;
  ciTestOutcome: string | null;
  retryCount: number | null;
  eventCount: number;
  tokenDataJson: string | null;
  costDataJson: string | null;
}

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 366;
const DEFAULT_LIMIT = 5_000;
const MAX_LIMIT = 50_000;

const RUN_QUERY = `
SELECT
  substr(coalesce(r.started_at, r.created_at), 1, 10) AS day,
  r.id AS runId,
  p.name AS project,
  t.id AS taskId,
  t.status AS taskStatus,
  r.purpose AS runPurpose,
  r.claim_worker_id AS worker,
  ap.name AS provider,
  ap.account_label AS providerAccount,
  r.model_ref AS model,
  r.billing_mode AS billingMode,
  r.started_at AS startedAt,
  r.ended_at AS endedAt,
  r.status AS resultStatus,
  d.status AS approvalState,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM verification_runs v
      WHERE v.agent_run_id = r.id AND v.status = 'failed'
    ) THEN 'failed'
    WHEN EXISTS (
      SELECT 1 FROM verification_runs v
      WHERE v.agent_run_id = r.id AND v.status IN ('pending', 'running')
    ) THEN 'pending'
    WHEN EXISTS (
      SELECT 1 FROM verification_runs v
      WHERE v.agent_run_id = r.id AND v.status = 'passed'
    ) THEN 'passed'
    ELSE NULL
  END AS ciTestOutcome,
  CASE
    WHEN c.attempt IS NULL THEN NULL
    WHEN c.attempt > 1 THEN c.attempt - 1
    ELSE 0
  END AS retryCount,
  (
    SELECT count(*) FROM agent_run_events e WHERE e.run_id = r.id
  ) AS eventCount,
  (
    SELECT u.data_json
    FROM usage_observations u
    WHERE u.agent_run_id = r.id AND u.kind = 'tokens'
    ORDER BY u.observed_at DESC, u.created_at DESC
    LIMIT 1
  ) AS tokenDataJson,
  (
    SELECT u.data_json
    FROM usage_observations u
    WHERE u.agent_run_id = r.id AND u.kind = 'cost'
    ORDER BY u.observed_at DESC, u.created_at DESC
    LIMIT 1
  ) AS costDataJson
FROM agent_runs r
JOIN tasks t ON t.id = r.task_id
JOIN projects p ON p.id = t.project_id
JOIN agent_providers ap ON ap.id = r.provider_id
LEFT JOIN task_claims c ON c.id = r.claim_id
LEFT JOIN decision_requests d ON d.id = r.paid_usage_decision_id
WHERE julianday(coalesce(r.started_at, r.created_at)) >=
  julianday(@asOf, '-' || @days || ' days')
  AND julianday(coalesce(r.started_at, r.created_at)) <= julianday(@asOf)
  AND (@project IS NULL OR p.name = @project)
  AND (@provider IS NULL OR ap.name = @provider)
  AND (@runPurpose IS NULL OR r.purpose = @runPurpose)
ORDER BY julianday(coalesce(r.started_at, r.created_at)) DESC, r.id
LIMIT @limit`;

const COMMAND_CENTRE_QUERY = `
SELECT 'task_status' AS metric, t.status AS status, count(*) AS count, max(t.updated_at) AS latestAt
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE (@project IS NULL OR p.name = @project)
  AND julianday(t.updated_at) <= julianday(@asOf)
GROUP BY t.status
UNION ALL
SELECT 'run_status' AS metric, r.status AS status,
  count(*) AS count,
  max(coalesce(r.ended_at, r.started_at, r.created_at)) AS latestAt
FROM agent_runs r
JOIN tasks t ON t.id = r.task_id
JOIN projects p ON p.id = t.project_id
JOIN agent_providers ap ON ap.id = r.provider_id
WHERE julianday(coalesce(r.started_at, r.created_at)) >=
  julianday(@asOf, '-' || @days || ' days')
  AND julianday(coalesce(r.started_at, r.created_at)) <= julianday(@asOf)
  AND (@project IS NULL OR p.name = @project)
  AND (@provider IS NULL OR ap.name = @provider)
  AND (@runPurpose IS NULL OR r.purpose = @runPurpose)
GROUP BY r.status
ORDER BY metric, status`;

function validatedOptions(
  options: ShaperReadOptions,
): Required<Pick<ShaperReadOptions, 'days' | 'limit' | 'asOf'>> &
  Omit<ShaperReadOptions, 'days' | 'limit' | 'asOf'> {
  const days = options.days ?? DEFAULT_DAYS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new Error(`days must be an integer from ${MIN_DAYS} to ${MAX_DAYS}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return {
    ...options,
    days,
    limit,
    asOf: options.asOf ?? new Date().toISOString(),
  };
}

function parsedObject(dataJson: string | null): Record<string, unknown> | undefined {
  if (!dataJson) return undefined;
  try {
    const value: unknown = JSON.parse(dataJson);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function firstNumber(
  data: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | null {
  if (!data) return null;
  for (const key of keys) {
    const value = nonNegativeNumber(data[key]);
    if (value !== null) return value;
  }
  return null;
}

function durationSeconds(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const elapsed = (Date.parse(endedAt) - Date.parse(startedAt)) / 1_000;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return Math.round(elapsed * 1_000) / 1_000;
}

function usageFields(
  raw: RawTelemetryRow,
): Pick<
  ShaperTelemetryRow,
  'inputTokens' | 'outputTokens' | 'totalTokens' | 'estimatedCost' | 'costCurrency'
> {
  const tokens = parsedObject(raw.tokenDataJson);
  const inputTokens = firstNumber(tokens, [
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
    'input',
  ]);
  const outputTokens = firstNumber(tokens, [
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
    'output',
  ]);
  const recordedTotal = firstNumber(tokens, ['totalTokens', 'total_tokens', 'total']);
  const totalTokens =
    recordedTotal ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const cost = parsedObject(raw.costDataJson);
  const estimatedCost = firstNumber(cost, ['estimatedCost', 'estimated_cost', 'cost']);
  const costCurrencyValue = cost?.currencyCode ?? cost?.currency;
  const costCurrency =
    typeof costCurrencyValue === 'string' && costCurrencyValue.trim()
      ? costCurrencyValue.trim()
      : null;
  return { inputTokens, outputTokens, totalTokens, estimatedCost, costCurrency };
}

/**
 * Read-only, dependency-free Shaper seam over Major's durable telemetry.
 * The query projects known operational fields and leaves unsupported metrics
 * as null. It never returns task text, event payloads, paths or credentials.
 */
export function readShaperTelemetry(
  sqlite: Database.Database,
  options: ShaperReadOptions = {},
): ShaperTelemetryRow[] {
  const values = validatedOptions(options);
  const rows = sqlite.prepare(RUN_QUERY).all({
    days: values.days,
    limit: values.limit,
    asOf: values.asOf,
    project: values.project ?? null,
    provider: values.provider ?? null,
    runPurpose: values.runPurpose ?? null,
  }) as RawTelemetryRow[];
  return rows.map((row) => ({
    recordType: 'run',
    day: row.day,
    runId: row.runId,
    project: row.project,
    taskId: row.taskId,
    taskStatus: row.taskStatus,
    taskFamily: null,
    runPurpose: row.runPurpose,
    worker: row.worker,
    provider: row.provider,
    providerAccount: row.providerAccount,
    model: row.model,
    billingMode: row.billingMode,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: durationSeconds(row.startedAt, row.endedAt),
    ...usageFields(row),
    cacheReuseStatus: null,
    retryCount: row.retryCount,
    concurrency: null,
    queueWaitSeconds: null,
    resultStatus: row.resultStatus,
    failureReason: null,
    approvalState: row.approvalState,
    humanInterventionState: null,
    ciTestOutcome: row.ciTestOutcome,
    qualityScore: null,
    skillsInvoked: null,
    gbrainReads: null,
    gbrainWrites: null,
    eventCount: row.eventCount,
  }));
}

/** Return current task counts and recent run counts for a compact control-centre view. */
export function readShaperCommandCentre(
  sqlite: Database.Database,
  options: ShaperReadOptions = {},
): ShaperCommandCentreRow[] {
  const values = validatedOptions(options);
  return sqlite.prepare(COMMAND_CENTRE_QUERY).all({
    days: values.days,
    asOf: values.asOf,
    project: values.project ?? null,
    provider: values.provider ?? null,
    runPurpose: values.runPurpose ?? null,
  }) as ShaperCommandCentreRow[];
}

type CsvValue = string | number | null;

const TELEMETRY_CSV_COLUMNS: readonly (readonly [keyof ShaperTelemetryRow, string])[] = [
  ['recordType', 'record_type'],
  ['day', 'day'],
  ['runId', 'run_id'],
  ['project', 'project'],
  ['taskId', 'task_id'],
  ['taskStatus', 'task_status'],
  ['taskFamily', 'task_family'],
  ['runPurpose', 'run_purpose'],
  ['worker', 'worker'],
  ['provider', 'provider'],
  ['providerAccount', 'provider_account'],
  ['model', 'model'],
  ['billingMode', 'billing_mode'],
  ['startedAt', 'started_at'],
  ['endedAt', 'ended_at'],
  ['durationSeconds', 'duration_seconds'],
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['totalTokens', 'total_tokens'],
  ['estimatedCost', 'estimated_cost'],
  ['costCurrency', 'cost_currency'],
  ['cacheReuseStatus', 'cache_reuse_status'],
  ['retryCount', 'retry_count'],
  ['concurrency', 'concurrency'],
  ['queueWaitSeconds', 'queue_wait_seconds'],
  ['resultStatus', 'result_status'],
  ['failureReason', 'failure_reason'],
  ['approvalState', 'approval_state'],
  ['humanInterventionState', 'human_intervention_state'],
  ['ciTestOutcome', 'ci_test_outcome'],
  ['qualityScore', 'quality_score'],
  ['skillsInvoked', 'skills_invoked'],
  ['gbrainReads', 'gbrain_reads'],
  ['gbrainWrites', 'gbrain_writes'],
  ['eventCount', 'event_count'],
];

function csvCell(value: CsvValue): string {
  if (value === null) return '';
  const text = typeof value === 'string' ? safeCsvString(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Neutralize spreadsheet formulas, including leading whitespace/control bypasses. */
function safeCsvString(value: string): string {
  const firstVisible = value.replace(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u, '').charAt(0);
  return ['=', '+', '-', '@'].includes(firstVisible) ? `'${value}` : value;
}

export function shaperTelemetryCsv(rows: readonly ShaperTelemetryRow[]): string {
  return (
    [
      TELEMETRY_CSV_COLUMNS.map(([, heading]) => heading).join(','),
      ...rows.map((row) => TELEMETRY_CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(',')),
    ].join('\n') + '\n'
  );
}

export function shaperCommandCentreCsv(rows: readonly ShaperCommandCentreRow[]): string {
  return (
    [
      'metric,status,count,latest_at',
      ...rows.map((row) =>
        [row.metric, row.status, row.count, row.latestAt].map(csvCell).join(','),
      ),
    ].join('\n') + '\n'
  );
}
