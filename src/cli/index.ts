#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
import { runDoctor } from '../doctor/doctor.js';
import { ClaudeCodeProvider } from '../providers/claude-code.js';
import { CodexProvider } from '../providers/codex.js';
import { persistProviderDiscovery } from '../providers/discovery-store.js';
import { route, type RoutingRequest } from '../routing/router.js';
import { dbDecisionRecorder } from '../security/audit.js';
import { CapabilityUnavailableError } from '../security/capabilities.js';
import { ExecutionGateway } from '../security/gateway.js';
import { TrustedExecutableRegistry } from '../security/trusted-executables.js';
import type { RunPurpose } from '../db/schema.js';

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

/** Executables the CLI's own probes may run (read-only discovery checks). */
const PROBE_EXECUTABLES = [
  'claude',
  'codex',
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
  return [new ClaudeCodeProvider({ gateway }), new CodexProvider({ gateway })];
}

program
  .command('doctor')
  .description('Check prerequisites, providers, models and overnight-execution safety')
  .option('--json', 'emit the full report as versioned JSON')
  .action(async (opts: { json?: boolean }) => {
    const database = db();
    const gateway = probeGateway(database);
    const report = await runDoctor({
      providers: providers(gateway),
      configuredProjects: listProjects(database).map((p) => ({
        name: p.name,
        repoPath: p.repoPath,
      })),
      resolve: (name) => gateway.resolveExecutable(name),
    });
    for (const info of report.providers) {
      persistProviderDiscovery(database, info, { source: 'cli' });
    }
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
        console.log(`✗ capability ${cap.capability}: unavailable (${cap.milestone})`);
      }
      // Overnight/autonomous LIVE execution is categorically unavailable in
      // this foundation; it is never reported as SAFE.
      console.log(
        `overnight execution: UNAVAILABLE — ${report.overnightExecutionReasons.join('; ')}`,
      );
      console.log(
        report.inspectionEnvironmentOk
          ? 'inspection environment (dry-run only): OK'
          : `inspection environment (dry-run only): NEEDS ATTENTION — ${report.inspectionEnvironmentIssues.join('; ')}`,
      );
    }
    // Exit code reflects the SUPPORTED (dry-run/inspection) health, not the
    // categorically-unavailable overnight execution.
    if (!report.inspectionEnvironmentOk) process.exit(EXIT.unsafe);
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
  .description('Approve a suggestion (UNAVAILABLE in this disabled foundation)')
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
  .command('run')
  .description('Plan an agent run for a task (dry-run only: live execution is unavailable)')
  .requiredOption('--task <taskId>', 'task to run')
  .addOption(
    new Option('--purpose <purpose>', 'run purpose')
      .choices(RUN_PURPOSES)
      .default('implementation'),
  )
  .option('--dry-run', 'show the routing decision without executing anything')
  .option('--json', 'emit versioned JSON')
  .action(async (opts: { task: string; purpose: RunPurpose; dryRun?: boolean; json?: boolean }) => {
    if (!opts.dryRun) {
      // Fail closed before any routing, run creation or subprocess: live
      // agent execution is an unavailable capability in this build, and the
      // same hard-coded gate refuses again at every deeper boundary
      // (gateway/exec/run-service) even if this check were bypassed.
      fail(
        'live execution is not enabled in this foundation build; use --dry-run — ' +
          new CapabilityUnavailableError('live-agent-execution').message,
        EXIT.refused,
      );
    }
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
      emitJson('run-dry-run', { task: taskRow, decision });
      return;
    }
    console.log(`task ${taskRow.id} [${taskRow.status}] ${taskRow.title}`);
    if (decision.kind === 'route') {
      console.log(
        `DRY RUN — would dispatch to ${decision.provider}/${decision.modelRef} ` +
          `(${decision.routingClass}, ${decision.billingMode})`,
      );
      console.log(`routing reason: ${decision.reason}`);
      if (decision.independenceLoss) {
        console.log(`independence loss: ${decision.independenceLoss}`);
      }
    } else {
      console.log(`DRY RUN — checkpoint: ${decision.reason}`);
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
