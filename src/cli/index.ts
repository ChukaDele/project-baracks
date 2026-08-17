#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import { openDb, type Db } from '../db/client.js';
import { SUGGESTION_SOURCE_TYPES, TASK_COMPLEXITIES, RUN_PURPOSES } from '../db/schema.js';
import {
  addSuggestion,
  addTask,
  approveSuggestion,
  getTask,
  incompleteDependencyCount,
  listTasks,
  queueableTasks,
  rejectSuggestion,
  SuggestionApprovalUnavailableError,
} from '../domain/task-service.js';
import { loadProjectConfig, resolveRepoPath } from '../config/project-config.js';
import { addProject, getProjectByName, listProjects } from '../config/project-service.js';
import { runDoctor, type DoctorReport } from '../doctor/doctor.js';
import {
  computeLiveExecutionReadiness,
  computeMultiProviderReadiness,
  computeProviderReadiness,
} from '../doctor/readiness.js';
import { ClaudeCodeProvider } from '../providers/claude-code.js';
import { CodexProvider } from '../providers/codex.js';
import { cursorProvider } from '../providers/cursor.js';
import { antigravityProvider } from '../providers/antigravity.js';
import { checkHostCredential } from '../providers/host-credential.js';
import { providerExecutable } from '../providers/commands.js';
import { runProviderLifecycleCli } from '../providers/lifecycle-cli.js';
import {
  hostIntegrationStatus,
  SUPPORTED_HOSTS,
  type SupportedHost,
} from '../context/host-integration.js';
import { readSupervisorState } from '../supervisor/state.js';
import { buildSupportBundle } from '../doctor/support-bundle.js';
import { runRollbackScript } from './lifecycle-ops.js';
import {
  loadPersistedProviderInfos,
  persistProviderDiscovery,
} from '../providers/discovery-store.js';
import { route, type RoutingRequest } from '../routing/router.js';
import { dbDecisionRecorder } from '../security/audit.js';
import { ExecutionGateway } from '../security/gateway.js';
import { TrustedExecutableRegistry } from '../security/trusted-executables.js';
import type { RunPurpose } from '../db/schema.js';
import { majorExecutionBackend } from '../security/major-gateway.js';
import {
  capabilityCandidateSchema,
  capabilityValidationSubject,
  getCapability,
  listCapabilities,
  planCapabilityAcquisition,
  provisionCapability,
  validateCapability,
} from '../capabilities/registry.js';

/**
 * Exit codes (stable, documented in docs/architecture.md):
 *   0 success
 *   1 unexpected error
 *   2 usage or validation error
 *   3 entity not found
 *   4 policy refusal (safety rule blocked the request)
 *   5 unsafe environment (doctor)
 */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  notFound: 3,
  refused: 4,
  unsafe: 5,
} as const;

/** Version of the machine-readable (--json) output envelope. */
const JSON_SCHEMA_VERSION = 1;

const program = new Command('major');
program.description('Major — autonomous engineering supervisor');
program.exitOverride();

function fail(message: string, code: number = EXIT.error): never {
  console.error(message);
  process.exit(code);
}

function emitJson(kind: string, data: unknown): void {
  console.log(
    JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, kind, ...({ data } as object) }),
  );
}

function db(): Db {
  return openDb().db;
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) fail(`JSON file not found: ${path}`, EXIT.usage);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(
      `invalid JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
      EXIT.usage,
    );
  }
}

/** Executables the CLI's own probes may run (read-only discovery checks). */
const PROBE_EXECUTABLES = [
  'claude',
  'codex',
  'cursor-agent',
  'agy',
  'git',
  'pnpm',
  'gh',
  'node',
  'tmux',
  'caffeinate',
  'which',
];

/** Probe-only gateway: nothing the CLI does in this build executes agent
 * work, and every probe is policy-checked and recorded in the audit table. */
function probeGateway(database: Db): ExecutionGateway {
  return ExecutionGateway.probeOnly({
    commandPolicy: { allowedExecutables: PROBE_EXECUTABLES },
    trustedExecutables: new TrustedExecutableRegistry(),
    recordDecision: dbDecisionRecorder(database),
  });
}

function providers(gateway: ExecutionGateway) {
  return [
    new ClaudeCodeProvider({ gateway }),
    new CodexProvider({ gateway }),
    cursorProvider({ gateway }),
    antigravityProvider({ gateway }),
  ];
}

/**
 * runDoctor's own providerReadiness/liveExecution reflect only THIS run's
 * fresh, resolution-only host discovery — never the persisted, authoritative
 * state from an isolated probe or a billing attestation (both recorded only
 * after runDoctor returns). Recompute readiness from the persisted state so
 * `major doctor`/`major setup` reflect what `major provider probe` and
 * `major provider attest-billing` actually observed, not just this run's
 * PATH resolution.
 */
function withPersistedReadiness(database: Db, report: DoctorReport): DoctorReport {
  const persisted = loadPersistedProviderInfos(database);
  const providerReadiness = persisted.map((info) => computeProviderReadiness(info));
  const liveExecution = computeLiveExecutionReadiness(report.core, providerReadiness);
  const multiProvider = computeMultiProviderReadiness(liveExecution);
  // overnightExecutionReasons embeds two provider-derived lines built from
  // THIS run's fresh discovery (the stale "no provider is READY: ..." from
  // liveExecutionBlockers, and the separate usable-provider check below) —
  // both must be replaced with the same reconciled data used above, or the
  // human-readable report can show a provider as e.g. AUTH_REQUIRED in one
  // section and NOT_CONFIGURED in another within the same run.
  const usableProvider = providerReadiness.some((p) => p.state === 'READY');
  const overnightExecutionReasons = report.overnightExecutionReasons
    .filter(
      (reason) =>
        !reason.startsWith('no provider is READY') &&
        !reason.startsWith('no verified+authenticated'),
    )
    .concat(
      liveExecution.blockers.filter((reason) => reason.startsWith('no provider is READY')),
      usableProvider
        ? []
        : [
            'no verified+authenticated agent provider (resolution-only discovery is not a provider ' +
              'lifecycle probe)',
          ],
    );
  return {
    ...report,
    providerReadiness,
    liveExecution,
    liveExecutionReady: liveExecution.ready,
    liveExecutionBlockers: liveExecution.blockers,
    multiProviderReady: multiProvider.ready,
    multiProvider,
    overnightExecutionReasons,
  };
}

program
  .command('doctor')
  .description('Check prerequisites, providers, models and overnight-execution safety')
  .option('--json', 'emit the full report as versioned JSON')
  .action(async (opts: { json?: boolean }) => {
    const database = db();
    const gateway = probeGateway(database);
    const freshReport = await runDoctor({
      providers: providers(gateway),
      configuredProjects: listProjects(database).map((p) => ({
        name: p.name,
        repoPath: p.repoPath,
      })),
      resolve: (name) => gateway.resolveExecutable(name),
      inspectExecutionBackend: () => majorExecutionBackend().inspect(),
    });
    for (const info of freshReport.providers) {
      persistProviderDiscovery(database, info, { source: 'cli' });
    }
    const report = withPersistedReadiness(database, freshReport);
    if (opts.json) {
      emitJson('doctor-report', report);
    } else {
      console.log(`OS: ${report.os}`);
      for (const check of report.checks) {
        const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '✗';
        console.log(`${icon} ${check.name}: ${check.detail}`);
      }
      for (const provider of report.providers) {
        const models = provider.models
          .map((m) => `${m.modelRef} [${m.routingClass}/${m.availability}/${m.billingMode}]`)
          .join(', ');
        console.log(`models(${provider.name}): ${models || 'none discovered'}`);
      }
      console.log(
        `projects: ${
          report.configuredProjects.map((p) => `${p.name} (${p.repoPath})`).join(', ') || 'none'
        }`,
      );
      if (report.missingPrerequisites.length > 0) {
        console.log(`missing prerequisites: ${report.missingPrerequisites.join(', ')}`);
      }
      for (const cap of report.capabilities) {
        console.log(
          `${cap.available ? '✓' : '✗'} capability ${cap.capability}: ${cap.available ? 'available' : `unavailable (${cap.milestone})`}`,
        );
      }
      // Foreground activation does not grant unattended/background authority.
      console.log(
        `overnight execution: UNAVAILABLE — ${report.overnightExecutionReasons.join('; ')}`,
      );
      console.log(
        report.inspectionEnvironmentOk
          ? 'inspection environment: OK'
          : `inspection environment: NEEDS ATTENTION — ${report.inspectionEnvironmentIssues.join('; ')}`,
      );
    }
    // Exit code reflects inspection health, not unattended authority.
    if (!report.inspectionEnvironmentOk) process.exit(EXIT.unsafe);
  });

interface HostReportRow {
  host: SupportedHost;
  cliInstalled: boolean;
  rulesInstalled: boolean;
  hookInstalled: boolean;
  attachedAt: string | undefined;
  project: string | undefined;
}

function buildHostsReport(gateway: ExecutionGateway): HostReportRow[] {
  const sessions = readSupervisorState().sessions;
  return SUPPORTED_HOSTS.map((host) => {
    const cliInstalled = gateway.resolveExecutable(providerExecutable(host)) !== undefined;
    const integration = hostIntegrationStatus(host);
    const latest = sessions
      .filter((session) => session.host === host)
      .sort((a, b) => b.attachedAt.localeCompare(a.attachedAt))[0];
    return {
      host,
      cliInstalled,
      ...integration,
      attachedAt: latest?.attachedAt,
      project: latest?.project,
    };
  });
}

function printHostsReport(rows: HostReportRow[]): void {
  console.log('MAJOR HOSTS\n');
  for (const row of rows) {
    const integrated =
      row.rulesInstalled && row.hookInstalled
        ? 'yes'
        : row.rulesInstalled
          ? 'rules only (no auto-attach hook)'
          : 'no';
    console.log(row.host);
    console.log(`  CLI installed         ${row.cliInstalled ? 'yes' : 'no'}`);
    console.log(`  Major integrated      ${integrated}`);
    console.log(`  last attached         ${row.attachedAt ?? 'never'}`);
    console.log(`  project               ${row.project ?? '-'}`);
    console.log('');
  }
  console.log(
    'Execution-provider health (READY/EXHAUSTED/...) is separate -- see `major provider status` or `major doctor`.',
  );
}

program
  .command('hosts')
  .description('Per-host Major integration status: CLI presence, rules/hook install, last attach')
  .option('--json', 'emit the full report as versioned JSON')
  .action((opts: { json?: boolean }) => {
    const database = db();
    const gateway = probeGateway(database);
    const rows = buildHostsReport(gateway);
    if (opts.json) {
      emitJson('hosts-report', { hosts: rows });
    } else {
      printHostsReport(rows);
    }
  });

const SETUP_PROVIDER_TO_HOST: Record<string, 'claude' | 'codex' | 'cursor' | 'antigravity'> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
};

async function buildSetupReport(database: Db) {
  const gateway = probeGateway(database);
  const freshReport = await runDoctor({
    providers: providers(gateway),
    configuredProjects: listProjects(database).map((p) => ({ name: p.name, repoPath: p.repoPath })),
    resolve: (name) => gateway.resolveExecutable(name),
    inspectExecutionBackend: () => majorExecutionBackend().inspect(),
  });
  for (const info of freshReport.providers) {
    persistProviderDiscovery(database, info, { source: 'cli' });
  }
  const report = withPersistedReadiness(database, freshReport);
  const hostLogins = report.providerReadiness.map((p) => {
    const host = SETUP_PROVIDER_TO_HOST[p.provider];
    const check = host ? checkHostCredential(host) : undefined;
    return {
      provider: p.provider,
      hostLoginFound: check?.status === 'found' || check?.status === 'unsafe',
    };
  });
  return { report, hostLogins };
}

function printSetupReport(report: DoctorReport): void {
  console.log('MAJOR SETUP\n');
  console.log('Core');
  console.log(`  isolated runner       ${report.core.ready ? '✓' : '✗'}`);
  if (!report.core.ready) {
    for (const issue of report.core.issues) console.log(`  - ${issue}`);
  }
  console.log('\nProviders');
  for (const p of report.providerReadiness) {
    const host = SETUP_PROVIDER_TO_HOST[p.provider];
    const hostCheck = host ? checkHostCredential(host) : undefined;
    console.log(`\n${p.provider}`);
    console.log(
      `  host login            ${hostCheck?.status === 'found' ? 'found' : hostCheck?.status === 'unsafe' ? 'found (' + hostCheck.detail.split('.')[0] + ')' : 'not found'}`,
    );
    console.log(`  Major login           ${p.state === 'READY' ? 'READY' : p.state}`);
    if (p.state !== 'READY') {
      console.log(`  action                major provider connect ${p.provider}`);
    }
  }
  console.log('\nMajor');
  console.log(`  live execution        ${report.liveExecutionReady ? 'READY' : 'NOT READY'}`);
  console.log(`  healthy providers     ${report.liveExecution.healthyProviders.length}`);
  console.log(`  fallback available    ${report.multiProviderReady ? 'YES' : 'NO'}`);
  console.log(
    `  overnight execution   DISABLED (${report.overnightExecutionReasons[0] ?? 'see major doctor'})`,
  );
  if (!report.liveExecutionReady) {
    console.log(`\nnot ready: ${report.liveExecution.blockers.join('; ')}`);
  }
  // Codex is the guaranteed self-service bootstrap provider (see
  // docs/readiness-model.md) — a friend with no execution provider connected
  // yet gets pointed at exactly one recommended next step, not a menu of
  // four equally-weighted options.
  if (report.liveExecution.healthyProviders.length === 0) {
    console.log('\nNo execution provider is connected.\n');
    console.log('Recommended:');
    console.log('  major provider connect codex');
  }
}

async function promptConnectCodexNow(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Connect Codex now? [Y/n] ')).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

program
  .command('setup')
  .description('Friend-facing readiness check: core, providers, and what to do next')
  .option('--json', 'emit the full report as versioned JSON')
  .option('--interactive', 'offer to connect Codex immediately when no provider is ready')
  .action(async (opts: { json?: boolean; interactive?: boolean }) => {
    const database = db();
    const { report, hostLogins } = await buildSetupReport(database);
    if (opts.json) {
      emitJson('setup-report', {
        core: report.core,
        providerReadiness: report.providerReadiness,
        hostLogins,
        liveExecution: report.liveExecution,
        multiProvider: report.multiProvider,
      });
      return;
    }
    printSetupReport(report);
    if (opts.interactive && report.liveExecution.healthyProviders.length === 0) {
      if (await promptConnectCodexNow()) {
        console.log();
        await runProviderLifecycleCli(['provider', 'connect', 'codex', '--yes']);
        console.log('\n---\n');
        const after = await buildSetupReport(db());
        printSetupReport(after.report);
      }
    }
  });

program
  .command('rollback')
  .description('Activate the release installed immediately before the current one')
  .action(() => {
    try {
      runRollbackScript();
    } catch (error) {
      fail(
        `rollback failed: ${error instanceof Error ? error.message : String(error)}`,
        EXIT.error,
      );
    }
  });

program
  .command('support-bundle')
  .description('Sanitized diagnostic bundle for sharing when asking for help')
  .option('--json', 'emit the full bundle as versioned JSON')
  .action(async (opts: { json?: boolean }) => {
    const database = db();
    const gateway = probeGateway(database);
    const freshReport = await runDoctor({
      providers: providers(gateway),
      configuredProjects: listProjects(database).map((p) => ({
        name: p.name,
        repoPath: p.repoPath,
      })),
      resolve: (name) => gateway.resolveExecutable(name),
      inspectExecutionBackend: () => majorExecutionBackend().inspect(),
    });
    for (const info of freshReport.providers) {
      persistProviderDiscovery(database, info, { source: 'cli' });
    }
    const report = withPersistedReadiness(database, freshReport);
    const bundle = buildSupportBundle(report);
    if (opts.json) {
      emitJson('support-bundle', bundle);
      return;
    }
    console.log('MAJOR SUPPORT BUNDLE\n');
    console.log(`generated       ${bundle.generatedAt}`);
    console.log(`os              ${bundle.os.platform} ${bundle.os.release} (${bundle.os.arch})`);
    console.log(
      `major           ${bundle.major.version ?? 'unknown'} sha=${bundle.major.installedSha ?? 'unknown'} gate=${bundle.major.releaseGateAtInstall ?? 'unknown'}`,
    );
    console.log(`worker          ${bundle.worker.instance ?? 'not configured'}`);
    console.log(`core ready      ${bundle.core.ready ? 'yes' : 'no'}`);
    console.log(
      `live execution  ${bundle.liveExecution.ready ? 'READY' : 'NOT READY'} (${bundle.liveExecution.healthyProviderCount} healthy provider(s))`,
    );
    for (const p of bundle.providers) {
      console.log(`  provider:${p.provider}  ${p.state}  ${p.detail}`);
    }
    if (bundle.errorChecks.length > 0) {
      console.log('\nissues:');
      for (const c of bundle.errorChecks) {
        console.log(`  ${c.status}  ${c.name}: ${c.detail}`);
      }
    }
    console.log('\n(share this output, or --json for the full sanitized bundle)');
  });

const project = program.command('project').description('Manage supervised projects');

project
  .command('add <configPath>')
  .description('Register a project from a JSON config file')
  .action((configPath: string) => {
    if (!existsSync(configPath)) fail(`config file not found: ${configPath}`, EXIT.usage);
    const config = loadProjectConfig(configPath);
    const repoPath = resolveRepoPath(config);
    if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
      fail(`repoPath does not exist or is not a directory: ${repoPath}`, EXIT.usage);
    }
    if (!existsSync(join(repoPath, '.git'))) {
      fail(`repoPath is not a git repository (no .git): ${repoPath}`, EXIT.usage);
    }
    const row = addProject(db(), config);
    console.log(`added project ${row.name} (${row.id})`);
  });

project
  .command('list')
  .description('List registered projects')
  .option('--json', 'emit versioned JSON')
  .action((opts: { json?: boolean }) => {
    const rows = listProjects(db());
    if (opts.json) {
      emitJson('project-list', rows);
      return;
    }
    if (rows.length === 0) {
      console.log('no projects registered');
      return;
    }
    for (const row of rows) {
      console.log(
        `${row.id}  ${row.name}  ${row.repoPath}${row.githubRepo ? `  ${row.githubRepo}` : ''}`,
      );
    }
  });

const capability = program
  .command('capability')
  .description('Plan and validate project-scoped Toolsmith capabilities');

capability
  .command('plan')
  .description('Reuse a proven capability or identify the safest provisional candidate')
  .requiredOption('--project <name>', 'registered project name')
  .requiredOption('--operation <name>', 'required operation')
  .requiredOption('--candidates <path>', 'JSON array of bounded candidate facts')
  .option('--json', 'emit versioned JSON')
  .action((opts: { project: string; operation: string; candidates: string; json?: boolean }) => {
    const database = db();
    const projectRow = requireProject(database, opts.project);
    const raw = readJsonFile(opts.candidates);
    if (!Array.isArray(raw)) fail('--candidates must contain a JSON array', EXIT.usage);
    const plan = planCapabilityAcquisition(database, {
      projectId: projectRow.id,
      operation: opts.operation,
      candidates: raw.map((candidate) => capabilityCandidateSchema.parse(candidate)),
    });
    if (opts.json) return emitJson('capability-plan', plan);
    if (plan.kind === 'reuse') {
      console.log(`reuse capability ${plan.capability.key} [${plan.capability.status}]`);
    } else if (plan.kind === 'provision') {
      console.log(`provision candidate ${plan.assessment.candidate.key} after sandbox preflight`);
    } else {
      console.log(`capability checkpoint: ${plan.reasons.join('; ')}`);
    }
  });

capability
  .command('provision')
  .description('Record a preflight-passing candidate as provisional; never installs it')
  .requiredOption('--project <name>', 'registered project name')
  .requiredOption('--candidate <path>', 'JSON candidate facts with sandbox preflight evidence')
  .action((opts: { project: string; candidate: string }) => {
    const database = db();
    const projectRow = requireProject(database, opts.project);
    const row = provisionCapability(database, {
      projectId: projectRow.id,
      candidate: capabilityCandidateSchema.parse(readJsonFile(opts.candidate)),
    });
    console.log(`provisional capability ${row.id} ${row.key}`);
  });

capability
  .command('validate')
  .description('Apply an independent validation result to a provisional capability')
  .requiredOption('--id <capabilityId>', 'capability id')
  .requiredOption('--reviewer <identity>', 'independent reviewer identity')
  .requiredOption('--verification-run <id>', 'passed verification run from that reviewer')
  .requiredOption('--evidence <summary>', 'independent validation evidence')
  .requiredOption('--artifact <path>', 'capability-specific verification artifact JSON')
  .requiredOption('--result <pass|fail>', 'independent validation result')
  .action(
    (opts: {
      id: string;
      reviewer: string;
      verificationRun: string;
      evidence: string;
      artifact: string;
      result: string;
    }) => {
      if (opts.result !== 'pass' && opts.result !== 'fail') {
        fail('--result must be pass or fail', EXIT.usage);
      }
      const row = validateCapability(db(), {
        id: opts.id,
        passed: opts.result === 'pass',
        reviewer: opts.reviewer,
        evidence: opts.evidence,
        verificationRunId: opts.verificationRun,
        artifact: readJsonFile(opts.artifact) as Parameters<
          typeof validateCapability
        >[1]['artifact'],
      });
      console.log(`capability ${row.id} ${row.status}`);
    },
  );

capability
  .command('validation-subject')
  .description('Print the immutable binding required on an independent verification run')
  .requiredOption('--id <capabilityId>', 'provisional capability id')
  .requiredOption('--operation <name>', 'capability operation under review')
  .action((opts: { id: string; operation: string }) => {
    const record = getCapability(db(), opts.id);
    if (record.status !== 'provisional' || !record.operations.includes(opts.operation)) {
      fail('validation subject requires a provisional capability operation', EXIT.usage);
    }
    console.log(capabilityValidationSubject(record, opts.operation));
  });

capability
  .command('list')
  .description('List project-scoped capability records')
  .requiredOption('--project <name>', 'registered project name')
  .option('--json', 'emit versioned JSON')
  .action((opts: { project: string; json?: boolean }) => {
    const database = db();
    const rows = listCapabilities(database, requireProject(database, opts.project).id);
    if (opts.json) return emitJson('capability-list', rows);
    for (const row of rows) console.log(`${row.id}  [${row.status}]  ${row.key}`);
  });

const task = program.command('task').description('Manage engineering tasks');

function requireProject(database: Db, name: string) {
  try {
    return getProjectByName(database, name);
  } catch {
    return fail(`project not found: ${name}`, EXIT.notFound);
  }
}

task
  .command('add')
  .description('Create a task directly (in draft status)')
  .requiredOption('--project <name>', 'project name')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description', '')
  .addOption(
    new Option('--complexity <level>', 'task complexity')
      .choices(TASK_COMPLEXITIES)
      .default('bounded'),
  )
  .action(
    (opts: {
      project: string;
      title: string;
      description: string;
      complexity: (typeof TASK_COMPLEXITIES)[number];
    }) => {
      const database = db();
      const projectRow = requireProject(database, opts.project);
      const row = addTask(database, {
        projectId: projectRow.id,
        title: opts.title,
        description: opts.description,
        complexity: opts.complexity,
      });
      console.log(`added task ${row.id} [${row.status}] ${row.title}`);
    },
  );

task
  .command('suggest')
  .description('Record a task suggestion (kept separate until approved)')
  .requiredOption('--project <name>', 'project name')
  .requiredOption('--title <title>', 'suggested task title')
  .option('--description <text>', 'description', '')
  .option('--rationale <text>', 'why this task should exist', '')
  .addOption(
    new Option('--source-type <type>', 'structured provenance')
      .choices(SUGGESTION_SOURCE_TYPES)
      .default('human'),
  )
  .option('--source-ref <id>', 'id of the originating record (finding/run/evidence/task)')
  .option('--supersedes <suggestionId>', 'explicitly supersede a rejected suggestion')
  .action(
    (opts: {
      project: string;
      title: string;
      description: string;
      rationale: string;
      sourceType: (typeof SUGGESTION_SOURCE_TYPES)[number];
      sourceRef?: string;
      supersedes?: string;
    }) => {
      const database = db();
      const projectRow = requireProject(database, opts.project);
      const input: Parameters<typeof addSuggestion>[1] = {
        projectId: projectRow.id,
        title: opts.title,
        description: opts.description,
        rationale: opts.rationale,
        sourceType: opts.sourceType,
      };
      if (opts.sourceRef !== undefined) input.sourceRef = opts.sourceRef;
      if (opts.supersedes !== undefined) input.supersedes = opts.supersedes;
      const result = addSuggestion(database, input);
      if (result.outcome === 'created') {
        console.log(
          `recorded suggestion ${result.suggestion.id} [pending] ${result.suggestion.title}`,
        );
      } else if (result.outcome === 'duplicate') {
        console.log(`duplicate of pending suggestion ${result.suggestion.id} — nothing recorded`);
      } else {
        fail(
          `suppressed: this scope was already rejected as ${result.suggestion.id} ` +
            `(pass --supersedes ${result.suggestion.id} to intentionally re-raise it)`,
          EXIT.refused,
        );
      }
    },
  );

task
  .command('approve <suggestionId>')
  .description('Approve a suggestion (UNAVAILABLE: separate owner gate)')
  .option('--note <text>', 'decision note')
  .action((suggestionId: string, opts: { note?: string }) => {
    // Route through the canonical mutation boundary, which refuses before any
    // database mutation. Map its refusal to the canonical unavailable exit code.
    try {
      const { task: created } = approveSuggestion(db(), suggestionId, opts.note);
      console.log(`approved ${suggestionId} -> task ${created.id} [${created.status}]`);
    } catch (error) {
      if (error instanceof SuggestionApprovalUnavailableError) fail(error.message, EXIT.refused);
      throw error;
    }
  });

task
  .command('reject <suggestionId>')
  .description('Reject a suggestion')
  .option('--note <text>', 'decision note')
  .action((suggestionId: string, opts: { note?: string }) => {
    const row = rejectSuggestion(db(), suggestionId, opts.note);
    console.log(`rejected ${row.id}`);
  });

task
  .command('list')
  .description('List tasks')
  .option('--project <name>', 'filter by project name')
  .option('--json', 'emit versioned JSON')
  .action((opts: { project?: string; json?: boolean }) => {
    const database = db();
    const projectId = opts.project ? requireProject(database, opts.project).id : undefined;
    const rows = listTasks(database, projectId);
    if (opts.json) {
      emitJson('task-list', rows);
      return;
    }
    if (rows.length === 0) {
      console.log('no tasks');
      return;
    }
    for (const row of rows) {
      console.log(`${row.id}  [${row.status}]  (${row.complexity})  ${row.title}`);
    }
  });

task
  .command('show <taskId>')
  .description('Show one task in detail')
  .option('--json', 'emit versioned JSON')
  .action((taskId: string, opts: { json?: boolean }) => {
    const database = db();
    let row;
    try {
      row = getTask(database, taskId);
    } catch {
      return fail(`task not found: ${taskId}`, EXIT.notFound);
    }
    const incomplete = incompleteDependencyCount(database, taskId);
    if (opts.json) {
      emitJson('task', { ...row, incompleteDependencies: incomplete });
      return;
    }
    console.log(JSON.stringify(row, null, 2));
    console.log(`incomplete dependencies: ${incomplete}`);
  });

program
  .command('queue')
  .description('Show tasks eligible to run next (queued, or ready with all dependencies done)')
  .option('--project <name>', 'filter by project name')
  .option('--json', 'emit versioned JSON')
  .action((opts: { project?: string; json?: boolean }) => {
    const database = db();
    const projectId = opts.project ? requireProject(database, opts.project).id : undefined;
    const rows = queueableTasks(database, projectId);
    if (opts.json) {
      emitJson('queue', rows);
      return;
    }
    if (rows.length === 0) {
      console.log('queue empty');
      return;
    }
    for (const row of rows) {
      console.log(`${row.id}  [${row.status}]  (${row.complexity})  ${row.title}`);
    }
  });

program
  .command('route')
  .description('Inspect the provider/model routing decision for a task without executing it')
  .requiredOption('--task <taskId>', 'task to run')
  .addOption(
    new Option('--purpose <purpose>', 'run purpose')
      .choices(RUN_PURPOSES)
      .default('implementation'),
  )
  .option('--json', 'emit versioned JSON')
  .action(async (opts: { task: string; purpose: RunPurpose; json?: boolean }) => {
    const database = db();
    let taskRow;
    try {
      taskRow = getTask(database, opts.task);
    } catch {
      return fail(`task not found: ${opts.task}`, EXIT.notFound);
    }
    const gateway = probeGateway(database);
    const infos = await Promise.all(providers(gateway).map((p) => p.discover()));
    for (const info of infos) persistProviderDiscovery(database, info, { source: 'cli' });
    const request: RoutingRequest = {
      purpose: opts.purpose,
      complexity: taskRow.complexity,
    };
    const decision = route(request, infos);
    if (opts.json) {
      emitJson('route-inspection', { task: taskRow, decision });
      return;
    }
    console.log(`task ${taskRow.id} [${taskRow.status}] ${taskRow.title}`);
    if (decision.kind === 'route') {
      console.log(
        `ROUTING PLAN — ${decision.provider}/${decision.modelRef} ` +
          `(${decision.routingClass}, ${decision.billingMode})`,
      );
      console.log(`routing reason: ${decision.reason}`);
      if (decision.independenceLoss) {
        console.log(`independence loss: ${decision.independenceLoss}`);
      }
    } else {
      console.log(`ROUTING PLAN — checkpoint: ${decision.reason}`);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (
      code === 'commander.helpDisplayed' ||
      code === 'commander.version' ||
      code === 'commander.help'
    ) {
      process.exit(EXIT.ok);
    }
    if (code.startsWith('commander.')) {
      process.exit(EXIT.usage);
    }
  }
  fail(error instanceof Error ? error.message : String(error));
});
