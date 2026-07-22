#!/usr/bin/env node
import { Command } from 'commander';
import { openDb } from '../db/client.js';
import { TASK_COMPLEXITIES, type TaskComplexity } from '../db/schema.js';
import { newId } from '../domain/ids.js';
import {
  addSuggestion,
  addTask,
  approveSuggestion,
  getTask,
  incompleteDependencyCount,
  listTasks,
  queueableTasks,
  rejectSuggestion,
} from '../domain/task-service.js';
import { loadProjectConfig } from '../config/project-config.js';
import { addProject, getProjectByName, listProjects } from '../config/project-service.js';
import { runDoctor } from '../doctor/doctor.js';
import { ClaudeCodeProvider } from '../providers/claude-code.js';
import { CodexProvider } from '../providers/codex.js';
import { route, type RoutingRequest } from '../routing/router.js';
import type { RunPurpose } from '../db/schema.js';

const program = new Command('major');
program.description('Major — autonomous engineering supervisor');

function db() {
  return openDb().db;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

program
  .command('doctor')
  .description('Check prerequisites, providers, models and overnight-execution safety')
  .option('--json', 'emit the full report as JSON')
  .action(async (opts: { json?: boolean }) => {
    const database = db();
    const report = await runDoctor({
      providers: [new ClaudeCodeProvider(), new CodexProvider()],
      configuredProjects: listProjects(database).map((p) => ({
        name: p.name,
        repoPath: p.repoPath,
      })),
    });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
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
    console.log(
      report.overnightSafe
        ? 'overnight execution: SAFE'
        : `overnight execution: NOT SAFE — ${report.overnightSafeReasons.join('; ')}`,
    );
  });

const project = program.command('project').description('Manage supervised projects');

project
  .command('add <configPath>')
  .description('Register a project from a JSON config file')
  .action((configPath: string) => {
    const config = loadProjectConfig(configPath);
    const row = addProject(db(), config);
    console.log(`added project ${row.name} (${row.id})`);
  });

project
  .command('list')
  .description('List registered projects')
  .action(() => {
    const rows = listProjects(db());
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

task
  .command('add')
  .description('Create a task directly (in draft status)')
  .requiredOption('--project <name>', 'project name')
  .requiredOption('--title <title>', 'task title')
  .option('--description <text>', 'task description', '')
  .option('--complexity <level>', `one of: ${TASK_COMPLEXITIES.join(', ')}`, 'bounded')
  .action((opts: { project: string; title: string; description: string; complexity: string }) => {
    if (!(TASK_COMPLEXITIES as readonly string[]).includes(opts.complexity)) {
      fail(`invalid complexity: ${opts.complexity}`);
    }
    const database = db();
    const projectRow = getProjectByName(database, opts.project);
    const row = addTask(database, {
      projectId: projectRow.id,
      title: opts.title,
      description: opts.description,
      complexity: opts.complexity as TaskComplexity,
    });
    console.log(`added task ${row.id} [${row.status}] ${row.title}`);
  });

task
  .command('suggest')
  .description('Record a task suggestion (kept separate until approved)')
  .requiredOption('--project <name>', 'project name')
  .requiredOption('--title <title>', 'suggested task title')
  .option('--description <text>', 'description', '')
  .option('--rationale <text>', 'why this task should exist', '')
  .action((opts: { project: string; title: string; description: string; rationale: string }) => {
    const database = db();
    const projectRow = getProjectByName(database, opts.project);
    const row = addSuggestion(database, {
      projectId: projectRow.id,
      title: opts.title,
      description: opts.description,
      rationale: opts.rationale,
    });
    console.log(`recorded suggestion ${row.id} [pending] ${row.title}`);
  });

task
  .command('approve <suggestionId>')
  .description('Approve a suggestion, materialising a draft task')
  .option('--note <text>', 'decision note')
  .action((suggestionId: string, opts: { note?: string }) => {
    const { task: created } = approveSuggestion(db(), suggestionId, opts.note);
    console.log(`approved ${suggestionId} -> task ${created.id} [${created.status}]`);
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
  .action((opts: { project?: string }) => {
    const database = db();
    const projectId = opts.project ? getProjectByName(database, opts.project).id : undefined;
    const rows = listTasks(database, projectId);
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
  .action((taskId: string) => {
    const database = db();
    const row = getTask(database, taskId);
    console.log(JSON.stringify(row, null, 2));
    console.log(`incomplete dependencies: ${incompleteDependencyCount(database, taskId)}`);
  });

program
  .command('queue')
  .description('Show tasks eligible to run next (queued, or ready with all dependencies done)')
  .option('--project <name>', 'filter by project name')
  .action((opts: { project?: string }) => {
    const database = db();
    const projectId = opts.project ? getProjectByName(database, opts.project).id : undefined;
    const rows = queueableTasks(database, projectId);
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
  .description('Plan (and later execute) an agent run for a task')
  .requiredOption('--task <taskId>', 'task to run')
  .option(
    '--purpose <purpose>',
    'implementation|verification|review|repair|analysis',
    'implementation',
  )
  .option('--dry-run', 'show the routing decision without executing anything')
  .action(async (opts: { task: string; purpose: string; dryRun?: boolean }) => {
    if (!opts.dryRun) {
      fail('live execution is not enabled in this foundation build; use --dry-run');
    }
    const database = db();
    const taskRow = getTask(database, opts.task);
    const providers = [new ClaudeCodeProvider(), new CodexProvider()];
    const infos = await Promise.all(providers.map((p) => p.discover()));
    const request: RoutingRequest = {
      purpose: opts.purpose as RunPurpose,
      complexity: taskRow.complexity,
    };
    const decision = route(request, infos);
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
      console.log(`run record would be created with id prefix arun_ (e.g. ${newId('arun')})`);
    } else {
      console.log(`DRY RUN — checkpoint: ${decision.reason}`);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
