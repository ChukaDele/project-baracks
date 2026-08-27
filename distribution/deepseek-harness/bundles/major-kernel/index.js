import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { withRoutedExecutionContext } from './route-context.js';

export const name = 'major-workstation';
export const inject = ['agents', 'commands', 'llm', 'subagents', 'subprocess'];

const OUTPUT_LIMIT = 256 * 1024;
const RESULT_LIMIT = 8 * 1024;
const NO_START_CAPABILITIES = Object.freeze({});
const SESSION_HOSTS = new Set(['claude', 'codex', 'cursor', 'antigravity']);
const NATIVE_APP_INTERACTION_ORIGIN = 'major-app/dsh';
const COMPOSER_ENVELOPE_PREFIX = 'MAJOR_DSH_COMPOSER_ENVELOPE_V1\n';
const FOREGROUND_DISPATCH_PREFIX = 'MAJOR_FOREGROUND_DISPATCH:';
const REVIEW_HASH_EXCLUSIONS = new Set(['node_modules']);
const GIT_CONTROL_NAMES = ['HEAD', 'index', 'config', 'packed-refs', 'commondir', 'hooks', 'refs'];
const REVIEW_HASH_MAX_ENTRIES = 100_000;
const REVIEW_HASH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const REVIEW_HASH_MAX_DEPTH = 64;
const LEASE_POLL_INITIAL_MS = 1_000;
const LEASE_POLL_MAX_MS = 5_000;
const LEASE_RELEASE_ATTEMPTS = 3;
const CODEX_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
const COMPOSER_CONTEXT_LIMIT = 32 * 1024;
const CODEX_USAGE_METHODS = ['account/read', 'account/rateLimits/read'];
export const RUN_INSIGHT_EVENT = 'major/run-insight';
export const RUN_INSIGHT_SCHEMA = 'major.run-insight.v1';
const INSIGHT_TEXT_LIMIT = 12_000;
const INSIGHT_LIST_LIMIT = 32;

/** Bind the independent review to one immutable workspace view. The upstream
 * Claude provider runs in plan mode; this second boundary detects any file,
 * mode, directory, or symlink change if that provider ever violates it. */
export function hashReviewWorkspace(root) {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  let entries = 0;
  let bytes = 0;

  const hashPath = (path, label, depth) => {
    if (depth > REVIEW_HASH_MAX_DEPTH) {
      throw new Error('major-workstation: review workspace exceeds directory depth limit');
    }
    const stat = lstatSync(path);
    entries += 1;
    if (entries > REVIEW_HASH_MAX_ENTRIES) {
      throw new Error('major-workstation: review workspace exceeds entry limit');
    }
    if (stat.isDirectory()) {
      hash.update(`d\0${label}\0${stat.mode & 0o777}\0`);
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (REVIEW_HASH_EXCLUSIONS.has(entry.name)) continue;
        const childPath = join(path, entry.name);
        const childLabel = `${label}/${entry.name}`;
        if (entry.name === '.git') hashGitState(childPath, childLabel);
        else hashPath(childPath, childLabel, depth + 1);
      }
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > REVIEW_HASH_MAX_BYTES) {
        throw new Error('major-workstation: review workspace exceeds byte limit');
      }
      hash.update(`f\0${label}\0${stat.mode & 0o777}\0`);
      hash.update(readFileSync(path));
    } else if (stat.isSymbolicLink()) {
      hash.update(`l\0${label}\0${readlinkSync(path)}\0`);
    } else {
      throw new Error(`major-workstation: unsupported review workspace object: ${label}`);
    }
  };

  const hashGitDirectory = (gitDirectory, label) => {
    for (const name of GIT_CONTROL_NAMES) {
      const path = join(gitDirectory, name);
      if (existsSync(path)) hashPath(path, `${label}/${name}`, 1);
    }
    const commonDirFile = join(gitDirectory, 'commondir');
    if (!existsSync(commonDirFile)) return;
    const commonDirectory = resolve(gitDirectory, readFileSync(commonDirFile, 'utf8').trim());
    for (const name of ['config', 'packed-refs', 'hooks', 'refs']) {
      const path = join(commonDirectory, name);
      if (existsSync(path)) hashPath(path, `${label}/common/${name}`, 1);
    }
  };

  const hashGitState = (gitPath, label) => {
    const stat = lstatSync(gitPath);
    if (stat.isDirectory()) {
      hash.update(`git\0${label}\0`);
      hashGitDirectory(gitPath, label);
      return;
    }
    if (!stat.isFile()) {
      hashPath(gitPath, label, 0);
      return;
    }
    hashPath(gitPath, label, 0);
    const pointer = readFileSync(gitPath, 'utf8')
      .trim()
      .match(/^gitdir:\s*(.+)$/i);
    if (pointer) hashGitDirectory(resolve(dirname(gitPath), pointer[1]), `${label}/worktree`);
  };

  const visit = (directory, depth) => {
    if (depth > REVIEW_HASH_MAX_DEPTH) {
      throw new Error('major-workstation: review workspace exceeds directory depth limit');
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (REVIEW_HASH_EXCLUSIONS.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const label = relative(canonicalRoot, path);
      if (entry.name === '.git' && directory === canonicalRoot) {
        hashGitState(path, label);
      } else {
        hashPath(path, label, depth);
      }
    }
  };

  visit(canonicalRoot, 0);
  return hash.digest('hex');
}

function sessionHost() {
  const host = process.env.MAJOR_SESSION_HOST;
  if (!SESSION_HOSTS.has(host)) {
    throw new Error(
      'major-workstation: set MAJOR_SESSION_HOST to claude, codex, cursor, or antigravity; Major run still routes the worker',
    );
  }
  return host;
}

function interactionOriginForTask(task) {
  return task.startsWith(COMPOSER_ENVELOPE_PREFIX) ? NATIVE_APP_INTERACTION_ORIGIN : undefined;
}

/** Keep plainly conversational turns inside the DSH coordinator. This is
 * deliberately small: other messages retain the existing execution path,
 * where the coordinator can still escalate when work is actually required. */
export function directCoordinatorResponse(task) {
  const normalized = task
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, '');
  if (/^how are you(?: today)?(?: major)?$/.test(normalized)) {
    return "I'm doing well and ready to help. I can chat, answer straightforward questions, or take on a substantive project task when you need work done.";
  }
  if (/^(?:hi|hello|hey)(?: major)?$/.test(normalized)) {
    return "Hello. I'm Major. What would you like to discuss or work on?";
  }
  return undefined;
}

function clip(value, limit = RESULT_LIMIT) {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

/** Persist a compact productive-work receipt in DSH's own session log. This is
 * deliberately best-effort: insight/observability must never turn completed
 * user work into a failed run. No Major-owned trajectory store is introduced. */
function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundedStrings(values) {
  return Array.isArray(values)
    ? values
        .filter((value) => typeof value === 'string' && value.trim())
        .slice(0, INSIGHT_LIST_LIMIT)
        .map((value) => clip(value.trim(), 1_000))
    : [];
}

function evidenceQualifiedEffects(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter(
      (value) =>
        value &&
        (value.effect === 'helped' || value.effect === 'hurt') &&
        typeof value.subject === 'string' &&
        value.subject.trim() &&
        typeof value.evidence === 'string' &&
        value.evidence.trim(),
    )
    .slice(0, INSIGHT_LIST_LIMIT)
    .map((value) => ({
      subject: clip(value.subject.trim(), 500),
      effect: value.effect,
      evidence: clip(value.evidence.trim(), 2_000),
    }));
}

function priorRunInsight(session) {
  return session?.events?.findLast?.(
    (candidate) =>
      candidate?.type === RUN_INSIGHT_EVENT && candidate?.data?.schema === RUN_INSIGHT_SCHEMA,
  )?.data;
}

function conservativeComparison(current, prior) {
  if (!prior) return { basis: 'none', result: 'no_prior_run' };
  const changes = {};
  if (current.outcome !== prior.outcome) {
    changes.outcome = { previous: prior.outcome, current: current.outcome };
  }
  for (const key of ['durationMs', 'productiveWorkRatio']) {
    const previous = prior?.timing?.[key];
    const next = current?.timing?.[key];
    if (typeof previous === 'number' && typeof next === 'number') {
      changes[key] = { previous, current: next, delta: next - previous };
    }
  }
  return Object.keys(changes).length
    ? { basis: 'latest_observed_run', result: 'observed_change_only', changes }
    : { basis: 'latest_observed_run', result: 'insufficient_comparable_evidence' };
}

/** Construct a deliberately conservative, compact receipt. Unknown values are
 * null/empty rather than inferred from prose. Helped/hurt claims require an
 * explicit evidence string, and every receipt remains an observation rather
 * than a learning candidate. */
export function buildRunInsight(insight, prior, nowMs = Date.now()) {
  const durationMs = finiteNonNegative(insight.durationMs);
  const stages = insight.stageTiming ?? {};
  const measuredStages = {
    admissionAndRoutingMs: finiteNonNegative(stages.admissionAndRoutingMs),
    leaseWaitMs: finiteNonNegative(stages.leaseWaitMs),
    workerExecutionMs: finiteNonNegative(stages.workerExecutionMs),
    goalReportMs: finiteNonNegative(stages.goalReportMs),
    leaseReleaseMs: finiteNonNegative(stages.leaseReleaseMs),
    reviewMs: finiteNonNegative(stages.reviewMs),
  };
  const measuredSum = (keys) =>
    keys.every((key) => measuredStages[key] !== null)
      ? keys.reduce((sum, key) => sum + measuredStages[key], 0)
      : null;
  const productiveWorkMs =
    finiteNonNegative(insight.productiveWorkMs) ?? measuredStages.workerExecutionMs;
  const explicitMajorOverheadMs = finiteNonNegative(insight.majorOverheadMs);
  const explicitInfrastructureOverheadMs = finiteNonNegative(insight.infrastructureOverheadMs);
  const derivedMajorOverheadMs = measuredSum(['admissionAndRoutingMs', 'goalReportMs', 'reviewMs']);
  const derivedInfrastructureOverheadMs = measuredSum(['leaseWaitMs', 'leaseReleaseMs']);
  const majorOverheadMs = explicitMajorOverheadMs ?? derivedMajorOverheadMs;
  const infrastructureOverheadMs =
    explicitInfrastructureOverheadMs ?? derivedInfrastructureOverheadMs;
  const overheadBasis =
    explicitMajorOverheadMs !== null || explicitInfrastructureOverheadMs !== null
      ? 'explicit_measurements'
      : derivedMajorOverheadMs !== null || derivedInfrastructureOverheadMs !== null
        ? 'measured_stage_sums'
        : null;
  const productiveWorkRatio =
    durationMs !== null && durationMs > 0 && productiveWorkMs !== null
      ? Math.min(1, productiveWorkMs / durationMs)
      : null;
  const receipt = {
    schema: RUN_INSIGHT_SCHEMA,
    recordedAt: new Date(nowMs).toISOString(),
    goalId: String(insight.goalId ?? 'unadmitted'),
    outcome: ['completed', 'blocked', 'failed', 'cancelled'].includes(insight.outcome)
      ? insight.outcome
      : 'completed',
    status: typeof insight.status === 'string' ? insight.status : 'unknown',
    runtime: typeof insight.runtime === 'string' ? insight.runtime : 'major',
    worker: {
      coordinator: typeof insight.coordinator === 'string' ? insight.coordinator : null,
      account: typeof insight.account === 'string' ? insight.account : null,
      provider: typeof insight.provider === 'string' ? insight.provider : null,
      model: typeof insight.model === 'string' ? insight.model : null,
      environment: typeof insight.environment === 'string' ? insight.environment : null,
    },
    timing: {
      durationMs,
      productiveWorkMs,
      productiveWorkRatio,
      productiveWorkRatioLabel:
        productiveWorkRatio === null
          ? null
          : 'worker_execution_ms / total_duration_ms (bounded 0..1)',
      majorOverheadMs,
      infrastructureOverheadMs,
      overheadBasis,
      stages: measuredStages,
    },
    productiveWork: clip(String(insight.summary ?? ''), INSIGHT_TEXT_LIMIT),
    skills: boundedStrings(insight.skills),
    effects: evidenceQualifiedEffects(insight.effects),
    failures: boundedStrings(insight.failures),
    recurrence: {
      signature:
        typeof insight.failureSignature === 'string' ? clip(insight.failureSignature, 500) : null,
      priorOccurrences: finiteNonNegative(insight.priorOccurrences),
      evidence:
        typeof insight.recurrenceEvidence === 'string'
          ? clip(insight.recurrenceEvidence, 2_000)
          : null,
    },
    humanInterventions: boundedStrings(insight.humanInterventions),
    quality: {
      assessment: ['passed', 'failed', 'mixed'].includes(insight.qualityAssessment)
        ? insight.qualityAssessment
        : 'unknown',
      evidence: boundedStrings(insight.qualityEvidence),
    },
    finalOutcome: clip(String(insight.finalOutcome ?? insight.summary ?? ''), INSIGHT_TEXT_LIMIT),
    reuseStrategy: {
      strategy: typeof insight.strategy === 'string' ? clip(insight.strategy, 1_000) : null,
      reusableAssets: boundedStrings(insight.reusableAssets),
    },
    learning: {
      disposition: 'observation_only',
      promotionEligible: false,
      durableMeaningOwner: 'gbrain',
    },
    telemetry: { highVolume: 'disabled_by_default', export: 'optional_async_best_effort' },
  };
  return { ...receipt, latestChange: conservativeComparison(receipt, prior) };
}

export function recordRunInsight(session, insight, durableAdapter) {
  if (!session || typeof session.append !== 'function') return false;
  try {
    const receipt = buildRunInsight(insight, priorRunInsight(session));
    session.append(RUN_INSIGHT_EVENT, receipt);
    try {
      durableAdapter?.(receipt);
    } catch {
      // The DSH receipt adapter is deliberately non-blocking. Major's durable
      // store being temporarily unavailable cannot reverse completed work.
    }
    return true;
  } catch {
    return false;
  }
}

export function latestRunInsight(session) {
  return priorRunInsight(session);
}

function textContent(blocks) {
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Read Major's last explicitly refreshed Codex snapshot for DSH's supported
 * provider/model status surfaces. This is display-only: it never starts Codex,
 * refreshes credentials, or changes Major routing eligibility. */
export function codexComposerReadiness(env = process.env) {
  const home = env.MAJOR_HOME || (env.HOME ? join(env.HOME, '.major') : undefined);
  const path = env.MAJOR_CODEX_USAGE_PATH || (home ? join(home, 'codex-usage.json') : undefined);
  if (!path || !existsSync(path)) {
    return {
      name: 'Major',
      description: 'Codex health unavailable — refresh with major provider usage',
    };
  }
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const fetchedAt = Date.parse(report?.fetchedAt);
    if (
      !report ||
      !Array.isArray(report.accounts) ||
      !Number.isFinite(fetchedAt) ||
      !Array.isArray(report.methods) ||
      report.methods.length !== CODEX_USAGE_METHODS.length ||
      !CODEX_USAGE_METHODS.every((method, index) => report.methods[index] === method)
    ) {
      throw new Error('invalid snapshot');
    }
    const health = report.accounts.map((account) => {
      if (!account || typeof account.accountLabel !== 'string' || !account.accountLabel) {
        throw new Error('invalid snapshot');
      }
      if (account.error !== undefined) {
        if (typeof account.error !== 'string' || !account.error.trim()) {
          throw new Error('invalid snapshot');
        }
        return { label: account.accountLabel, health: 'error' };
      }
      for (const window of [account.primary, account.secondary]) {
        if (window === undefined) continue;
        if (!window || typeof window !== 'object' || Array.isArray(window)) {
          throw new Error('invalid snapshot');
        }
        if (
          window.usedPercent !== undefined &&
          (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent))
        ) {
          throw new Error('invalid snapshot');
        }
      }
      if (!account.primary) return { label: account.accountLabel, health: 'unknown' };
      const usedPercent = account.primary.usedPercent;
      if (usedPercent === undefined) return { label: account.accountLabel, health: 'unknown' };
      return {
        label: account.accountLabel,
        health: usedPercent >= 100 ? 'exhausted' : 'healthy',
      };
    });
    const total = report.accounts.length;
    const healthy = health.filter((account) => account.health === 'healthy').length;
    const observedAt = Number.isFinite(Date.parse(env.MAJOR_CODEX_USAGE_NOW ?? ''))
      ? Date.parse(env.MAJOR_CODEX_USAGE_NOW)
      : Date.now();
    const stale = observedAt - fetchedAt > CODEX_SNAPSHOT_MAX_AGE_MS;
    const detail = health.map((account) => `${account.label} ${account.health}`).join(', ');
    return {
      name: `Major — Codex health ${healthy}/${total} healthy${stale ? ' (stale)' : ''}`,
      description:
        `${detail || 'no Codex accounts'}; usage at last refresh ${report.fetchedAt}; ` +
        'source: account/read + account/rateLimits/read; refresh: major provider usage',
    };
  } catch {
    return {
      name: 'Major',
      description: 'Codex health snapshot is invalid — refresh with major provider usage',
    };
  }
}

function majorExecutable() {
  if (process.env.MAJOR_BIN) return process.env.MAJOR_BIN;
  const home = process.env.HOME;
  if (!home) throw new Error('major-workstation: HOME is required to resolve the Major CLI');
  return join(home, '.local', 'bin', 'major');
}

/** Forward a compact receipt to Major's SQLite/GBrain observation path. This
 * is intentionally fire-and-forget; the DSH session receipt remains useful
 * operational evidence, but is never a second learning store. */
function persistRunInsight(ctx, cwd, project, receipt) {
  if (!project || process.env.MAJOR_RUN_INSIGHT_DURABLE_ADAPTER === '0') return;
  try {
    const child = ctx.subprocess.spawn({
      argv: [
        majorExecutable(),
        'history',
        'record',
        '--project',
        project,
        '--source',
        'dsh',
        '--receipt-base64',
        Buffer.from(JSON.stringify(receipt)).toString('base64url'),
      ],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: 3_000,
    });
    child.done?.catch?.(() => undefined);
  } catch {
    // Best-effort adapter: never fail the user task for insight persistence.
  }
}

async function runProcess(ctx, cwd, argv, signal) {
  const child = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: OUTPUT_LIMIT },
      stderr: { maxBytes: OUTPUT_LIMIT },
    },
    graceMs: 3_000,
    signal,
  });
  const outcome = await child.done;
  const stdout = child.collected.stdout?.readFrom(0).text ?? '';
  if (outcome.exitCode !== 0) {
    throw new Error(
      `major-workstation: ${argv[1] ?? 'command'} failed with exit ${String(outcome.exitCode)}`,
    );
  }
  return stdout;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`major-workstation: ${label} returned invalid JSON`);
  }
}

function goalCycle(goal, label) {
  const cycle = goal?.cycle;
  if (typeof cycle !== 'number' || !Number.isFinite(cycle)) {
    throw new Error(`major-workstation: ${label} returned a non-numeric goal cycle`);
  }
  return cycle;
}

export function foregroundDispatchHops(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .findLast((candidate) => candidate.startsWith(FOREGROUND_DISPATCH_PREFIX));
  if (!line) throw new Error('major-workstation: Major run returned no dispatch receipt');
  const receipt = parseJson(
    line.slice(FOREGROUND_DISPATCH_PREFIX.length).trim(),
    'dispatch receipt',
  );
  if (!Number.isInteger(receipt?.hops) || receipt.hops < 0) {
    throw new Error('major-workstation: Major run returned an invalid dispatch receipt');
  }
  return receipt.hops;
}

export function configuredRuntimeRoute(env = process.env) {
  const environment = env.MAJOR_DSH_EXECUTION_ENVIRONMENT;
  if (environment === undefined || environment === '' || environment === 'local') {
    return { environment: 'local' };
  }
  if (environment === 'legacy') return undefined;
  if (environment !== 'local' && environment !== 'lima') {
    throw new Error(`major-workstation: unsupported DSH execution environment: ${environment}`);
  }
  return { environment };
}

export function dshAdapterForMajorHost(host, environment = 'local', accountLabel = 'default') {
  if (host === 'codex') {
    if (environment === 'lima') return 'codex-lima';
    return accountLabel === 'default' ? 'codex' : `codex-${accountLabel}`;
  }
  if (host === 'claude') return 'claude-review';
  throw new Error(
    `major-workstation: Major selected ${String(host)}, which has no live DSH adapter`,
  );
}

async function acquireWorkerLease(ctx, major, goal, maxRunMinutes, signal) {
  const owner = `dsh-goal-${goal.id}`;
  let pollMs = LEASE_POLL_INITIAL_MS;
  for (;;) {
    signal.throwIfAborted();
    const result = parseJson(
      await runProcess(
        ctx,
        goal.repoPath,
        [
          major,
          'resource',
          'acquire',
          '--kind',
          'worker',
          '--owner',
          owner,
          '--project',
          goal.project,
          '--pid',
          String(process.pid),
          '--ttl-minutes',
          String(maxRunMinutes + 5),
        ],
        signal,
      ),
      'resource acquire',
    );
    if (result.status === 'active' && typeof result.lease?.id === 'string') {
      return result.lease;
    }
    if (result.status !== 'queued') {
      throw new Error(
        `major-workstation: worker resource refused: ${String(result.reason ?? 'unknown reason')}`,
      );
    }
    await new Promise((resolveWait, rejectWait) => {
      const complete = () => {
        signal.removeEventListener('abort', abort);
        resolveWait();
      };
      const timer = setTimeout(complete, pollMs);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        rejectWait(signal.reason ?? new Error('major-workstation: resource wait aborted'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer.unref?.();
    });
    pollMs = Math.min(pollMs * 2, LEASE_POLL_MAX_MS);
  }
}

function withRoutedContext(selection, goalId, lease, callback) {
  return withRoutedExecutionContext(
    {
      goalId,
      accountLabel: selection.accountLabel,
      modelRef: selection.modelRef,
      leaseId: lease.id,
      leasePid: String(process.pid),
    },
    callback,
  );
}

async function releaseWorkerLease(ctx, major, cwd, lease) {
  let lastError;
  for (let attempt = 1; attempt <= LEASE_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await runProcess(
        ctx,
        cwd,
        [major, 'resource', 'release', '--lease', lease.id, '--json'],
        undefined,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < LEASE_RELEASE_ATTEMPTS) {
        await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 250));
      }
    }
  }
  throw lastError;
}

export function nativeWorkerTask(task, resolvedSkills = [], skillResolutionDegraded = false) {
  const skillContext = skillResolutionDegraded
    ? 'Major skill and GBrain resolution is temporarily unavailable. Continue without it and report the degraded context if material.'
    : resolvedSkills.length === 0
      ? 'No existing Major or GBrain-generated skill matched this task.'
      : resolvedSkills
          .map(
            (skill) =>
              `--- MAJOR SKILL ${String(skill.id)} (${String(skill.source)}) ---\n${String(skill.content)}`,
          )
          .join('\n\n');
  return `MAJOR LEAF WORKER CONTRACT:
Major has already admitted this goal and selected you through the DSH runtime. You are the leased leaf worker, not the control-plane coordinator. Do not run Major CLI commands, admit or dispatch another goal, or delegate to another worker. Perform the task directly in the current workspace, run its verification, and report the observed result.

OPERATING PRINCIPLE:
- Start with the smallest credible end-to-end MVP. Make it work, make it useful, then improve or harden it.
- Reuse an existing project pattern, maintained library, validated tool, skill or provider capability before building a new subsystem.
- Keep the shared current-goal state useful: record the critical path, ownership, interfaces, decisions and objective evidence in the project context when the task changes them.
- Work the critical path first. Parallel capacity belongs to the parent coordinator; serialize only real write, interface, ordering or scarce-resource conflicts.
- Prefer deletion and a simpler design over new moving parts. Use FAST checks while iterating and prove the acceptance path before broader hardening.

RESOLVED MAJOR SKILLS AND GBRAIN CONTEXT:
${skillContext}

TASK:
${task}`;
}

async function admitMajorTask(ctx, cwd, task, signal, interactionOrigin, sessionId) {
  const major = majorExecutable();
  const host = interactionOrigin ? undefined : sessionHost();
  const attachArgs = [major, 'session', 'attach', '--cwd', cwd];
  if (host) attachArgs.push('--host', host);
  if (interactionOrigin) attachArgs.push('--interaction-origin', interactionOrigin);
  if (sessionId) attachArgs.push('--session-id', sessionId);
  await runProcess(ctx, cwd, attachArgs, signal);
  const admissionArgs = [major, 'goal', 'admit', '--cwd', cwd];
  if (host) admissionArgs.push('--host', host);
  if (interactionOrigin) admissionArgs.push('--interaction-origin', interactionOrigin);
  if (sessionId) admissionArgs.push('--session-id', sessionId);
  admissionArgs.push('--outcome', task);
  const admitted = parseJson(await runProcess(ctx, cwd, admissionArgs, signal), 'goal admit');
  if (admitted.admitted !== true || typeof admitted.goalId !== 'string') {
    throw new Error(`major-workstation: ${String(admitted.reason ?? 'goal admission refused')}`);
  }
  if (admitted.ownLiveWork !== true) {
    throw new Error('major-workstation: another Major session owns live work for this goal');
  }
  return { major, admitted };
}

async function executeMajor(ctx, cwd, task, signal, interactionOrigin, sessionId) {
  const { major, admitted } = await admitMajorTask(
    ctx,
    cwd,
    task,
    signal,
    interactionOrigin,
    sessionId,
  );
  const beforeGoal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show before run',
  );
  const beforeCycle = goalCycle(beforeGoal, 'goal show before run');
  if (typeof beforeGoal?.project !== 'string' || !beforeGoal.project) {
    throw new Error('major-workstation: goal show before run returned no project identity');
  }
  const runStdout = await runProcess(
    ctx,
    cwd,
    [major, 'run', beforeGoal.project, '--goal-id', admitted.goalId, '--foreground'],
    signal,
  );
  if (foregroundDispatchHops(runStdout) === 0) {
    throw new Error(
      'major-workstation: Major run completed without dispatching a cycle; another integration owner may hold the repo lock',
    );
  }
  const goal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show',
  );
  const afterCycle = goalCycle(goal, 'goal show');
  if (afterCycle <= beforeCycle) {
    throw new Error('major-workstation: Major run completed without advancing the goal cycle');
  }
  return {
    project: beforeGoal.project,
    goalId: admitted.goalId,
    status: typeof goal.status === 'string' ? goal.status : 'unknown',
    coordinator: typeof goal.lastCoordinator === 'string' ? goal.lastCoordinator : 'unknown',
    account: typeof goal.lastAccountLabel === 'string' ? goal.lastAccountLabel : 'unknown',
  };
}

async function executeNativeDsh(
  ctx,
  cwd,
  task,
  parent,
  signal,
  route,
  interactionOrigin,
  sessionId,
) {
  const admissionAndRoutingStartedAtMs = Date.now();
  const { major, admitted } = await admitMajorTask(
    ctx,
    cwd,
    task,
    signal,
    interactionOrigin,
    sessionId,
  );
  const goal = parseJson(
    await runProcess(ctx, cwd, [major, 'goal', 'show', '--id', admitted.goalId], signal),
    'goal show before native run',
  );
  if (
    goal.id !== admitted.goalId ||
    goal.repoPath !== cwd ||
    typeof goal.project !== 'string' ||
    !goal.project
  ) {
    throw new Error('major-workstation: admitted goal does not match the DSH project directory');
  }
  const selection = parseJson(
    await runProcess(
      ctx,
      cwd,
      [
        major,
        'goal',
        'route-execution',
        '--id',
        admitted.goalId,
        '--environment',
        route.environment,
      ],
      signal,
    ),
    'goal route-execution',
  );
  if (selection.kind !== 'route') {
    throw new Error(
      `major-workstation: provider routing checkpoint: ${String(selection.reason ?? 'no eligible route')}`,
    );
  }
  if (!Number.isInteger(selection.maxRunMinutes) || selection.maxRunMinutes <= 0) {
    throw new Error('major-workstation: Major returned an invalid native run limit');
  }
  const dshProviderName = dshAdapterForMajorHost(
    selection.host,
    route.environment,
    selection.accountLabel,
  );
  const admissionAndRoutingMs = Date.now() - admissionAndRoutingStartedAtMs;
  const leaseWaitStartedAtMs = Date.now();
  const lease = await acquireWorkerLease(ctx, major, goal, selection.maxRunMinutes, signal);
  const leaseWaitMs = Date.now() - leaseWaitStartedAtMs;
  const executionSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(selection.maxRunMinutes * 60 * 1_000),
  ]);
  let executionError;
  let completedResult;
  let leaseReleaseMs = null;
  try {
    const workerExecutionStartedAtMs = Date.now();
    const run = await withRoutedContext(selection, admitted.goalId, lease, () =>
      settleSubagent(
        ctx,
        dshProviderName,
        nativeWorkerTask(task, selection.resolvedSkills, selection.skillResolutionDegraded),
        parent,
        executionSignal,
      ),
    );
    const workerExecutionMs = Date.now() - workerExecutionStartedAtMs;
    if (run.stopReason !== 'completed') {
      throw new Error(
        `major-workstation: ${dshProviderName} ended with ${run.stopReason}` +
          (run.diagnostic ? `: ${run.diagnostic}` : ''),
      );
    }
    const summary = textContent(run.output) || `${dshProviderName} completed without text output`;
    const goalReportStartedAtMs = Date.now();
    await runProcess(
      ctx,
      cwd,
      [
        major,
        'goal',
        'report',
        '--id',
        admitted.goalId,
        '--status',
        'active',
        '--summary',
        clip(
          `DSH ${route.environment}/${selection.provider}/${selection.modelRef} completed: ${summary}`,
          12_000,
        ),
      ],
      signal,
    );
    const goalReportMs = Date.now() - goalReportStartedAtMs;
    completedResult = {
      project: goal.project,
      goalId: admitted.goalId,
      status: 'active',
      coordinator: selection.host,
      account: selection.accountLabel,
      runtime: 'dsh',
      provider: selection.provider,
      model: selection.modelRef,
      environment: route.environment,
      summary,
      skills: boundedStrings(selection.resolvedSkills?.map((skill) => skill?.id)),
      stageTiming: {
        admissionAndRoutingMs,
        leaseWaitMs,
        workerExecutionMs,
        goalReportMs,
        leaseReleaseMs: null,
        reviewMs: null,
      },
    };
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    const leaseReleaseStartedAtMs = Date.now();
    try {
      await releaseWorkerLease(ctx, major, cwd, lease);
    } catch (releaseError) {
      if (executionError) {
        throw new AggregateError(
          [executionError, releaseError],
          'major-workstation: native execution failed and its worker lease could not be released',
        );
      }
      completedResult.summary = clip(
        `${completedResult.summary}\n\nInfrastructure warning: the task completed, but Major could not ` +
          `release worker lease ${lease.id} after ${LEASE_RELEASE_ATTEMPTS} attempts; ` +
          'the lease remains bounded by its configured TTL.',
        12_000,
      );
    } finally {
      leaseReleaseMs = Date.now() - leaseReleaseStartedAtMs;
      if (completedResult) completedResult.stageTiming.leaseReleaseMs = leaseReleaseMs;
    }
  }
  return completedResult;
}

export function createMajorProvider(ctx) {
  return {
    name: 'major',
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request) {
      const startedAtMs = Date.now();
      const cwd = request.parent.session.header.cwd;
      if (!cwd) throw new Error('major-workstation: the DSH session has no project directory');
      const task = textContent(request.prompt);
      if (!task) throw new Error('major-workstation: a non-empty text task is required');
      const interactionOrigin = interactionOriginForTask(task);
      const sessionId = request.parent.session.id;
      const localAbort = new AbortController();
      const signal = AbortSignal.any([request.signal, localAbort.signal]);
      const route = configuredRuntimeRoute();
      const execution = route
        ? executeNativeDsh(
            ctx,
            cwd,
            task,
            request.parent,
            signal,
            route,
            interactionOrigin,
            sessionId,
          )
        : executeMajor(ctx, cwd, task, signal, interactionOrigin, sessionId);
      const result = execution.then(
        (run) => {
          const route =
            run.runtime === 'dsh'
              ? ` DSH runtime route: provider=${run.provider}; model=${run.model};` +
                ` account=${run.account}; environment=${run.environment}.` +
                ` Worker result: ${run.summary}`
              : '';
          const text =
            `Major goal ${run.goalId} finished this increment with ${run.coordinator}` +
            ` account ${run.account}; goal status ${run.status}.${route}`;
          recordRunInsight(
            request.parent.session,
            {
              ...run,
              outcome: 'completed',
              summary: run.summary ?? text,
              durationMs: Date.now() - startedAtMs,
              finalOutcome: text,
            },
            (receipt) => persistRunInsight(ctx, cwd, run.project, receipt),
          );
          return {
            output: [
              {
                type: 'text',
                text,
              },
            ],
            stopReason: 'completed',
          };
        },
        (error) => {
          const diagnostic = clip(error instanceof Error ? error.message : String(error));
          recordRunInsight(request.parent.session, {
            outcome: signal.aborted ? 'cancelled' : 'failed',
            status: signal.aborted ? 'aborted' : 'failed',
            runtime: route ? 'dsh' : 'major',
            provider: route?.provider,
            environment: route?.environment,
            durationMs: Date.now() - startedAtMs,
            summary: diagnostic,
            finalOutcome: diagnostic,
            failures: [diagnostic],
            failureSignature: signal.aborted ? 'cancelled' : 'execution_error',
          });
          return {
            output: [],
            stopReason: signal.aborted ? 'aborted' : 'error',
            diagnostic,
          };
        },
      );
      return {
        id: randomUUID(),
        localAgent: undefined,
        result,
        async dispose() {
          if (!localAbort.signal.aborted) {
            localAbort.abort(new Error('major-workstation: run disposed'));
          }
          await result;
        },
      };
    },
  };
}

function latestComposerTask(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || message.source?.kind !== 'user') continue;
    const task = textContent(message.content ?? []);
    if (task) return task;
  }
  throw new Error('major-workstation: the composer request has no direct user text task');
}

/** Preserve DSH's system and multi-turn message contract while making the
 * current direct user request the only authority for the bounded Major task. */
export function composerTaskWithContext(messages, system) {
  const currentTask = latestComposerTask(messages);
  const currentIndex = messages.findLastIndex(
    (message) =>
      message?.role === 'user' &&
      message.source?.kind === 'user' &&
      textContent(message.content ?? []),
  );
  const history = messages
    .slice(0, currentIndex)
    .map((message) => {
      const text = textContent(message?.content ?? []);
      if (!text) return undefined;
      const role = typeof message.role === 'string' ? message.role : 'unknown';
      return { role, text };
    })
    .filter(Boolean);
  const systemText = typeof system === 'string' ? system.trim() : '';
  const envelope = {
    schema: 'major.dsh.composer.v1',
    authority: {
      currentDirectUserTask: currentTask,
      dshSystemPrompt: systemText || null,
    },
    contextOnly: { conversationHistory: history },
  };
  const prefix = 'MAJOR_DSH_COMPOSER_ENVELOPE_V1\n';
  let encoded = JSON.stringify(envelope);
  if (prefix.length + encoded.length > COMPOSER_CONTEXT_LIMIT) {
    envelope.contextOnly.conversationHistory = history.slice();
    while (
      envelope.contextOnly.conversationHistory.length > 0 &&
      encoded.length + prefix.length > COMPOSER_CONTEXT_LIMIT
    ) {
      envelope.contextOnly.conversationHistory.shift();
      encoded = JSON.stringify(envelope);
    }
    if (encoded.length + prefix.length > COMPOSER_CONTEXT_LIMIT) {
      envelope.contextOnly.conversationHistory = [];
      encoded = JSON.stringify(envelope);
    }
  }
  return `${prefix}${encoded}`;
}

/** Root DSH model adapter whose one response is an existing Major provider
 * run. Keeping this at the LLM seam gives normal composer turns ordinary DSH
 * durability, restart, chat, and trajectory behavior for free. */
export function createMajorComposerAdapter(ctx) {
  const metadata = () => codexComposerReadiness();
  return {
    providerInfo(provider) {
      return { id: provider, name: metadata().name };
    },
    providerRetryPolicy() {
      return undefined;
    },
    listModels(provider) {
      return Promise.resolve([
        {
          provider,
          id: 'composer',
          name: metadata().name,
          description: metadata().description,
          inputModalities: ['text'],
        },
      ]);
    },
    resolveModel(provider, model) {
      return Promise.resolve({
        provider,
        id: model,
        name: metadata().name,
        description: metadata().description,
        inputModalities: ['text'],
      });
    },
    async *stream(options) {
      if (!options.sessionId) {
        throw new Error('major-workstation: the composer request has no DSH session identity');
      }
      const parent = ctx.agents.get(options.sessionId);
      if (!parent) {
        throw new Error('major-workstation: the composer session has no live DSH agent');
      }
      const direct = directCoordinatorResponse(latestComposerTask(options.messages));
      if (direct) {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: direct };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: direct } };
        yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
        return;
      }
      const task = composerTaskWithContext(options.messages, options.system);
      const result = await executeMajorIncrement(ctx, task, parent, options.signal);
      if (result.kind !== 'success') throw new Error(result.text);
      const output = result.text;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: output };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: output } };
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
}

async function settleSubagent(ctx, provider, prompt, parent, signal) {
  const run = await ctx.subagents.start(provider, {
    prompt: [{ type: 'text', text: prompt }],
    parent,
    signal,
  });
  try {
    return await run.result;
  } finally {
    await run.dispose();
  }
}

function failedResult(provider, result) {
  const detail = result.diagnostic ? `: ${result.diagnostic}` : '';
  return {
    kind: 'error',
    text: `${provider} ended with ${result.stopReason}${detail}`,
  };
}

/** One normal composer message maps to one routed native Major increment.
 * The worker's focused verification is returned directly; a mandatory second
 * provider review would consume the only physical worker slot and turn every
 * ordinary request into duplicate validation ceremony. */
async function executeMajorIncrement(ctx, task, parent, signal) {
  const result = await settleSubagent(ctx, 'major', task, parent, signal);
  if (result.stopReason !== 'completed') return failedResult('Major', result);
  return { kind: 'success', text: textContent(result.output) };
}

/** Execute one existing Major provider increment and bind an independent,
 * plan-mode Claude review to the resulting workspace. Both ordinary composer
 * turns and the diagnostic /major command use this exact execution boundary. */
export async function executeMajorWithClaudeReview(ctx, task, parent, signal) {
  const majorResult = await settleSubagent(ctx, 'major', task, parent, signal);
  if (majorResult.stopReason !== 'completed') return failedResult('Major', majorResult);

  const majorSummary = textContent(majorResult.output);
  const cwd = parent.session.header.cwd;
  if (!cwd) return { kind: 'error', text: 'The DSH session has no project directory.' };
  const beforeReview = hashReviewWorkspace(cwd);
  let reviewResult;
  try {
    reviewResult = await settleSubagent(
      ctx,
      'claude-review',
      [
        'Independently review the current repository after this Major increment.',
        'You are running in native plan mode. Inspect the diff and relevant tests without modifying files.',
        'Return a concise verdict with concrete findings.',
        `Requested task: ${task}`,
        `Major execution: ${majorSummary}`,
      ].join('\n'),
      parent,
      signal,
    );
  } finally {
    if (hashReviewWorkspace(cwd) !== beforeReview) {
      throw new Error('major-workstation: Claude review changed the project workspace');
    }
  }
  if (reviewResult.stopReason !== 'completed') return failedResult('Claude review', reviewResult);

  return {
    kind: 'success',
    text: clip(
      `${majorSummary}\n\nClaude independent review:\n${textContent(reviewResult.output)}`,
    ),
  };
}

/** Commands are log-only, but DSH rc.8 considers a persisted session blank
 * until its first turn/start. Use an otherwise empty, completed turn so the
 * upstream session list durably retains valid /major executions. */
function nextTurn(session) {
  return (
    session.events.reduce(
      (maximum, event) =>
        event.type === 'turn/start' || event.type === 'turn/end'
          ? Math.max(maximum, event.data.turn)
          : maximum,
      0,
    ) + 1
  );
}

export function apply(ctx) {
  if (!ctx.llm || typeof ctx.llm.registerAdapter !== 'function') {
    throw new Error(
      'major-workstation: DSH llm service is required for the default Major composer',
    );
  }
  ctx.subagents.registerProvider(createMajorProvider(ctx));
  ctx.llm.registerAdapter(['major'], createMajorComposerAdapter(ctx));
  ctx.commands.register({
    name: 'major-insight',
    description: 'show the latest durable Major productive-work receipt',
    input: { hint: 'show latest receipt' },
    handler: async (invocation) => {
      const insight = latestRunInsight(invocation.agent.session);
      if (!insight) {
        return { kind: 'error', text: 'No Major run insight is recorded in this session yet.' };
      }
      return { kind: 'success', text: JSON.stringify(insight, null, 2) };
    },
  });
  ctx.commands.register({
    name: 'major',
    description: 'run one Major increment with Codex and an independent Claude review',
    input: { hint: '<task>' },
    handler: async (invocation) => {
      const task = invocation.rawInput.trim();
      if (!task) return { kind: 'error', text: 'Usage: /major <task>' };
      const session = invocation.agent.session;
      const turn = nextTurn(session);
      session.append('turn/start', { turn });
      try {
        return await executeMajorWithClaudeReview(ctx, task, invocation.agent, invocation.signal);
      } finally {
        session.append('turn/end', { turn, reason: { kind: 'completed' } });
      }
    },
  });
}
