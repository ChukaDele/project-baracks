#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  executeStagedCliProviderField,
  stagedFieldExecutionConfig,
  stagedFieldValidationNonce,
} from './staged-field-support.mjs';

const { limactlPath, instance } = stagedFieldExecutionConfig();
const root = mkdtempSync(join(tmpdir(), 'major-cli-provider-field-'));
const nonce = stagedFieldValidationNonce();
let passed = false;

const providers = [
  { host: 'claude', executable: 'claude', allowGuestMutation: true },
  { host: 'codex', executable: 'codex', allowGuestMutation: false },
  { host: 'antigravity', executable: 'agy', allowGuestMutation: false },
];

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

function assertStopped() {
  const rows = command(limactlPath, ['list', '--json'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const worker = rows.find((row) => row.name === instance);
  if (!worker) fail(`required Lima instance is absent: ${instance}`);
  if (worker.status !== 'Stopped') fail(`Lima instance is not stopped: ${worker.status}`);
}

async function runProvider(provider) {
  const filename = `MAJOR_${provider.host.toUpperCase()}_FIELD.txt`;
  const expected = `MAJOR_${provider.host.toUpperCase()}_FIELD_${nonce}\n`;
  const handle = executeStagedCliProviderField({
    provider: provider.host,
    nonce,
  });
  const workspace = handle.workspace;
  let events = 0;
  let evidence = '';
  for await (const event of handle.events) {
    events += 1;
    evidence += `${typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}\n`;
  }
  const outcome = await handle.outcome;
  if (outcome.status !== 'succeeded' || outcome.cleanup !== 'complete') {
    fail(`${provider.host} field execution failed: ${JSON.stringify(outcome)}`);
  }
  if (events === 0) fail(`${provider.host} emitted no provider-owned output`);
  if (provider.allowGuestMutation) {
    if (readFileSync(join(workspace, filename), 'utf8') !== expected) {
      fail(`${provider.host} returned incorrect file content`);
    }
  } else if (!evidence.includes(expected.trim())) {
    fail(`${provider.host} returned incorrect read-only result`);
  }
  const status = command('/usr/bin/git', [
    '-C',
    workspace,
    'status',
    '--porcelain',
    '-uall',
  ]).trim();
  const expectedStatus = provider.allowGuestMutation ? `?? ${filename}` : '';
  if (status !== expectedStatus) fail(`${provider.host} returned unexpected delta: ${status}`);
  const visible = readdirSync(workspace)
    .filter((name) => name !== '.git')
    .sort();
  const expectedVisible = provider.allowGuestMutation ? filename : '';
  if (visible.join('\n') !== expectedVisible) {
    fail(`${provider.host} returned unexpected files: ${visible.join(', ')}`);
  }
  assertStopped();
  if (outcome.modelSelection !== 'supported') {
    fail(`${provider.host} did not report its model-selection capability`);
  }
  if ((provider.host === 'claude' || provider.host === 'codex') && !outcome.sessionRef) {
    fail(`${provider.host} did not preserve a session reference`);
  }
  await handle.validateEvidence();
  return {
    provider: provider.host,
    runId: outcome.runId,
    cleanup: outcome.cleanup,
    sessionEvidence: outcome.sessionRef ? 'present' : 'unsupported-or-missing',
    usageEvidence: outcome.usage === undefined ? 'unsupported-or-missing' : 'present',
  };
}

try {
  if (!existsSync(limactlPath)) fail(`limactl is absent: ${limactlPath}`);
  assertStopped();
  const results = [];
  for (const provider of providers) results.push(await runProvider(provider));
  passed = true;
  process.stdout.write(
    `${JSON.stringify({
      gate: 'cli-provider-field',
      status: 'PASS',
      results,
      instanceStatus: 'Stopped',
    })}\n`,
  );
} finally {
  if (passed && process.env.MAJOR_PROVIDER_FIELD_KEEP !== '1') {
    rmSync(root, { recursive: true, force: true });
  } else if (!passed) {
    process.stderr.write(`CLI provider field artifacts retained at ${root}\n`);
  }
}
