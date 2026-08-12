#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LimaBackend } from '../dist/execution/lima-backend.js';
import { providerArgs } from '../dist/providers/commands.js';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  parseProviderEventLine,
} from '../dist/providers/evidence.js';

const limactlPath = resolve(process.env.MAJOR_LIMACTL_PATH ?? '/opt/homebrew/bin/limactl');
const instance = process.env.MAJOR_LIMA_INSTANCE ?? 'major-worker';
const root = mkdtempSync(join(tmpdir(), 'major-cli-provider-field-'));
const nonce = randomUUID();
let passed = false;

process.env.MAJOR_HOME = join(root, 'major-home');

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

function backend() {
  return new LimaBackend({
    backend: 'lima',
    instance,
    limactlPath,
    isolationScope: 'shared-workshop',
    guestRunRoot: '/var/lib/major/runs',
  });
}

async function runProvider(provider) {
  const workspace = join(root, `${provider.host}-workspace`);
  const filename = `MAJOR_${provider.host.toUpperCase()}_FIELD.txt`;
  const expected = `MAJOR_${provider.host.toUpperCase()}_FIELD_${nonce}\n`;
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  command('/usr/bin/git', ['-C', workspace, 'init', '--initial-branch=field']);
  const prompt = provider.allowGuestMutation
    ? `Create ${filename} containing exactly ${expected.trim()} followed by one newline. ` +
      'Use only file reading and editing tools. Do not run a shell command. Do not modify any other file.'
    : `Read the empty repository and respond with exactly ${expected.trim()}. Do not use shell, network, ` +
      'or file-writing tools.';
  const handle = backend().execute({
    executable: provider.executable,
    args: providerArgs(provider.host, { prompt, outputMode: 'batch' }),
    cwd: workspace,
    allowedRoots: [workspace],
    timeoutMs: 300_000,
    providerRequest: {
      host: provider.host,
      prompt,
      allowGuestMutation: provider.allowGuestMutation,
      approvalAuthority: { approvedCategories: [] },
    },
    parseLine: parseProviderEventLine,
    extractSessionRef: (event) => extractProviderSessionRef(provider.host, event),
    extractUsage: extractProviderUsage,
  });
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
