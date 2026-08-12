#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LimaBackend } from '../dist/execution/lima-backend.js';

const limactlPath = resolve(process.env.MAJOR_LIMACTL_PATH ?? '/opt/homebrew/bin/limactl');
const instance = process.env.MAJOR_LIMA_INSTANCE ?? 'major-worker';
const root = mkdtempSync(join(tmpdir(), 'major-cursor-acp-field-'));
const majorHome = join(root, 'major-home');
const successWorkspace = join(root, 'success-workspace');
const cancelWorkspace = join(root, 'cancel-workspace');
const nonce = randomUUID();
const expected = `MAJOR_CURSOR_ACP_FIELD_${nonce}\n`;
const resumed = `MAJOR_CURSOR_ACP_RESUME_${nonce}\n`;
let passed = false;

process.env.MAJOR_HOME = majorHome;

function fail(message) {
  throw new Error(message);
}

function command(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: `${dirname(limactlPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'C.UTF-8',
    },
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${executable} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function initWorkspace(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  command('/usr/bin/git', ['-C', path, 'init', '--initial-branch=field']);
}

function backend() {
  return new LimaBackend({
    backend: 'lima',
    instance,
    limactlPath,
    isolationScope: 'shared-workshop',
    guestRunRoot: '/var/lib/major/runs',
  });
}

function assertStopped() {
  const rows = command(limactlPath, ['list', '--json'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const worker = rows.find((row) => row.name === instance);
  if (!worker) fail(`required Lima instance is absent: ${instance}`);
  if (worker.status !== 'Stopped') fail(`Lima instance is not stopped: ${worker.status}`);
}

function assertOnlyChange(workspace, expectedPath) {
  const status = command('/usr/bin/git', [
    '-C',
    workspace,
    'status',
    '--porcelain',
    '-uall',
  ]).trim();
  if (status !== `?? ${expectedPath}`) fail(`unexpected host workspace delta: ${status}`);
  const visible = readdirSync(workspace)
    .filter((name) => name !== '.git')
    .sort();
  if (visible.join('\n') !== expectedPath) {
    fail(`unexpected host workspace files: ${visible.join(', ')}`);
  }
}

async function executeCursor({
  workspace,
  prompt,
  modelRef,
  resumeSessionRef,
  timeoutMs = 240_000,
  cancel,
}) {
  const handle = backend().execute({
    executable: 'cursor-agent',
    args: ['acp'],
    cwd: workspace,
    allowedRoots: [workspace],
    timeoutMs,
    providerRequest: {
      host: 'cursor',
      prompt,
      allowGuestMutation: true,
      approvalAuthority: { decisions: [] },
      ...(modelRef ? { modelRef } : {}),
      ...(resumeSessionRef ? { resumeSessionRef } : {}),
    },
  });
  let acpUpdates = 0;
  let providerResults = 0;
  let cancelScheduled = false;
  for await (const event of handle.events) {
    if (event.type === 'acp-session-update') {
      acpUpdates += 1;
      if (cancel && !cancelScheduled) {
        cancelScheduled = true;
        setTimeout(() => handle.cancel(), 2_000).unref();
      }
    }
    if (event.type === 'provider-result') providerResults += 1;
  }
  return { outcome: await handle.outcome, acpUpdates, providerResults, cancelScheduled };
}

try {
  if (!existsSync(limactlPath)) fail(`limactl is absent: ${limactlPath}`);
  assertStopped();
  initWorkspace(successWorkspace);

  const created = await executeCursor({
    workspace: successWorkspace,
    prompt:
      `Create CURSOR_ACP_FIELD.txt containing exactly ${expected.trim()} followed by one newline. ` +
      'Do not modify any other file.',
  });
  if (created.outcome.status !== 'succeeded' || created.outcome.cleanup !== 'complete') {
    fail(`Cursor ACP create failed: ${JSON.stringify(created.outcome)}`);
  }
  if (!created.outcome.sessionRef) fail('Cursor ACP create returned no session reference');
  if (created.outcome.modelSelection !== 'supported' || !created.outcome.actualModel) {
    fail(`Cursor ACP did not report its model capability: ${JSON.stringify(created.outcome)}`);
  }
  if (created.acpUpdates === 0 || created.providerResults !== 1) {
    fail(`Cursor ACP create emitted incomplete typed evidence: ${JSON.stringify(created)}`);
  }
  if (readFileSync(join(successWorkspace, 'CURSOR_ACP_FIELD.txt'), 'utf8') !== expected) {
    fail('Cursor ACP create returned incorrect file content');
  }
  assertOnlyChange(successWorkspace, 'CURSOR_ACP_FIELD.txt');
  assertStopped();

  command('/usr/bin/git', ['-C', successWorkspace, 'add', 'CURSOR_ACP_FIELD.txt']);
  const continued = await executeCursor({
    workspace: successWorkspace,
    resumeSessionRef: created.outcome.sessionRef,
    modelRef: created.outcome.actualModel,
    prompt:
      `Continue this session. Create CURSOR_ACP_RESUME.txt containing exactly ${resumed.trim()} ` +
      'followed by one newline. Do not modify any other file.',
  });
  if (continued.outcome.status !== 'succeeded' || continued.outcome.cleanup !== 'complete') {
    fail(`Cursor ACP resume failed: ${JSON.stringify(continued.outcome)}`);
  }
  if (continued.outcome.sessionRef !== created.outcome.sessionRef) {
    fail('Cursor ACP resume did not preserve the session reference');
  }
  if (
    continued.outcome.requestedModel !== created.outcome.actualModel ||
    continued.outcome.actualModel !== created.outcome.actualModel
  ) {
    fail(`Cursor ACP did not honour the explicit model: ${JSON.stringify(continued.outcome)}`);
  }
  if (continued.acpUpdates === 0 || continued.providerResults !== 1) {
    fail(`Cursor ACP resume emitted incomplete typed evidence: ${JSON.stringify(continued)}`);
  }
  if (readFileSync(join(successWorkspace, 'CURSOR_ACP_RESUME.txt'), 'utf8') !== resumed) {
    fail('Cursor ACP resume returned incorrect file content');
  }
  const resumeStatus = command('/usr/bin/git', [
    '-C',
    successWorkspace,
    'status',
    '--porcelain',
    '-uall',
  ]).trim();
  if (resumeStatus !== 'A  CURSOR_ACP_FIELD.txt\n?? CURSOR_ACP_RESUME.txt') {
    fail(`unexpected resumed workspace delta: ${resumeStatus}`);
  }
  assertStopped();

  initWorkspace(cancelWorkspace);
  const cancelled = await executeCursor({
    workspace: cancelWorkspace,
    prompt:
      'Analyze the repository in depth and prepare a long architecture report. Do not modify files or run shell commands.',
    timeoutMs: 120_000,
    cancel: true,
  });
  if (!cancelled.cancelScheduled)
    fail('Cursor ACP cancellation was not triggered by a real update');
  if (cancelled.outcome.status !== 'cancelled' || cancelled.outcome.cleanup !== 'complete') {
    fail(`Cursor ACP cancellation failed: ${JSON.stringify(cancelled.outcome)}`);
  }
  if (existsSync(join(cancelWorkspace, 'CURSOR_ACP_CANCEL_MUST_NOT_EXIST.txt'))) {
    fail('cancelled Cursor ACP run mutated the host workspace');
  }
  const cancelStatus = command('/usr/bin/git', [
    '-C',
    cancelWorkspace,
    'status',
    '--porcelain',
    '-uall',
  ]).trim();
  if (cancelStatus) fail(`cancelled Cursor ACP run changed the host workspace: ${cancelStatus}`);
  assertStopped();

  passed = true;
  process.stdout.write(
    `${JSON.stringify({
      gate: 'cursor-acp-field',
      status: 'PASS',
      createRunId: created.outcome.runId,
      resumeRunId: continued.outcome.runId,
      cancelRunId: cancelled.outcome.runId,
      sessionRef: created.outcome.sessionRef,
      selectedModel: continued.outcome.actualModel,
      cleanup: 'complete',
      instanceStatus: 'Stopped',
    })}\n`,
  );
} finally {
  if (passed && process.env.MAJOR_CURSOR_FIELD_KEEP !== '1') {
    rmSync(root, { recursive: true, force: true });
  } else if (!passed) {
    process.stderr.write(`Cursor ACP field artifacts retained at ${root}\n`);
  }
}
