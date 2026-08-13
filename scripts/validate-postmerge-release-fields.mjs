#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  executeStagedReleaseField,
  stagedFieldExecutionConfig,
  stagedFieldValidationNonce,
} from './staged-field-support.mjs';

const jssSource = process.env.MAJOR_JSS_FIELD_SOURCE;
const surfaceSource = process.env.MAJOR_SURFACE_FIELD_SOURCE;
if (!jssSource || !surfaceSource) {
  throw new Error('MAJOR_JSS_FIELD_SOURCE and MAJOR_SURFACE_FIELD_SOURCE are required');
}
const nonce = stagedFieldValidationNonce();
const { limactlPath, instance } = stagedFieldExecutionConfig();
const root = join(homedir(), '.major', 'staged-validation', 'workspaces', nonce);

function command(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    },
    ...options,
  }).trim();
}

function prepare(source, kind, expectedRemote, expectedSha) {
  const canonical = resolve(source);
  const remote = command('/usr/bin/git', ['-C', canonical, 'remote', 'get-url', 'origin']);
  if (!expectedRemote.test(remote)) throw new Error(`${kind} source remote is not canonical`);
  command('/usr/bin/git', ['-C', canonical, 'fetch', '--quiet', 'origin', 'main']);
  const fetched = command('/usr/bin/git', ['-C', canonical, 'rev-parse', 'FETCH_HEAD']);
  if (expectedSha && fetched !== expectedSha) {
    throw new Error(`${kind} fetched main does not match the exact release SHA`);
  }
  const destination = join(root, kind);
  if (existsSync(destination)) throw new Error(`field workspace already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  command('/usr/bin/git', [
    'clone',
    '--quiet',
    '--local',
    '--no-hardlinks',
    canonical,
    destination,
  ]);
  command('/usr/bin/git', ['-C', destination, 'remote', 'set-url', 'origin', remote]);
  command('/usr/bin/git', ['-C', destination, 'checkout', '--quiet', '--detach', fetched]);
  const detached = command('/usr/bin/git', ['-C', destination, 'rev-parse', 'HEAD']);
  if (
    detached !== fetched ||
    command('/usr/bin/git', ['-C', destination, 'status', '--porcelain'])
  ) {
    throw new Error(`${kind} workspace is not a clean detached exact SHA`);
  }
  return { workspace: destination, sha: fetched };
}

async function run(caseId, project, phase = 'recovery', predecessorLeaseId) {
  const handle = executeStagedReleaseField({
    caseId,
    nonce,
    workspace: project.workspace,
    projectSha: project.sha,
    phase,
    ...(predecessorLeaseId ? { predecessorLeaseId } : {}),
  });
  let eventCount = 0;
  for await (const _event of handle.events) eventCount += 1;
  const outcome = await handle.outcome;
  if (outcome.status !== 'succeeded' || outcome.cleanup !== 'complete' || eventCount === 0) {
    throw new Error(`${caseId} failed: ${JSON.stringify(outcome)}`);
  }
  await handle.validateEvidence();
  return {
    caseId,
    runId: outcome.runId,
    projectSha: project.sha,
    eventCount,
    cleanup: outcome.cleanup,
  };
}

function assertStopped() {
  const rows = command(limactlPath, ['list', '--json'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const worker = rows.find((row) => row.name === instance);
  if (!worker || worker.status !== 'Stopped') throw new Error('release worker is not stopped');
}

const release = JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8'));
const majorSource = release.sourceCheckout;
const results = [];
const jss = prepare(jssSource, 'jss-field', /ChukaDele\/jss-tool(?:\.git)?$/i);
results.push(await run('jss-field', jss));
assertStopped();

const surface = prepare(
  surfaceSource,
  'surface-talent-field',
  /Surface-Talent\/surface-talent(?:\.git)?$/i,
);
results.push(await run('surface-talent-field', surface));
assertStopped();

const cross = prepare(jssSource, 'cross-project-isolation', /ChukaDele\/jss-tool(?:\.git)?$/i);
results.push(await run('cross-project-isolation', cross));
if (command('/usr/bin/git', ['-C', surface.workspace, 'status', '--porcelain'])) {
  throw new Error('cross-project run changed the Surface Talent workspace');
}
assertStopped();

const failure = prepare(
  majorSource,
  'failure-recovery',
  /ChukaDele\/project-baracks(?:\.git)?$/i,
  release.sha,
);
const failed = executeStagedReleaseField({
  caseId: 'failure-recovery',
  nonce,
  workspace: failure.workspace,
  projectSha: failure.sha,
  phase: 'failure',
});
let forced = false;
for await (const _event of failed.events) {
  if (!forced) {
    forced = true;
    command(limactlPath, ['stop', '--force', instance]);
  }
}
const failedOutcome = await failed.outcome;
if (
  !forced ||
  !['failed', 'cancelled', 'timed_out'].includes(failedOutcome.status) ||
  failedOutcome.cleanup !== 'complete'
) {
  throw new Error(`forced failure was not contained: ${JSON.stringify(failedOutcome)}`);
}
assertStopped();
results.push(await run('failure-recovery', failure, 'recovery', failed.validationLeaseId));
assertStopped();

for (const caseId of ['burn-in-1', 'burn-in-2', 'burn-in-3']) {
  const workspace = prepare(
    majorSource,
    caseId,
    /ChukaDele\/project-baracks(?:\.git)?$/i,
    release.sha,
  );
  results.push(await run(caseId, workspace));
  assertStopped();
}

process.stdout.write(
  `${JSON.stringify({
    gate: 'postmerge-release-fields',
    status: 'PASS',
    exactSha: release.sha,
    forcedFailureRunId: failedOutcome.runId,
    results,
    instanceStatus: 'Stopped',
  })}\n`,
);
