#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  executeStagedCliProviderField,
  stagedFieldExecutionConfig,
  stagedFieldValidationNonce,
} from './staged-field-support.mjs';

const { limactlPath, instance } = stagedFieldExecutionConfig();
const root = mkdtempSync(join(tmpdir(), 'major-cli-provider-field-'));
const nonce = stagedFieldValidationNonce();

const providers = [
  { host: 'claude', executable: 'claude', allowGuestMutation: true },
  { host: 'codex', executable: 'codex', allowGuestMutation: false },
  { host: 'antigravity', executable: 'agy', allowGuestMutation: false },
];

class ProviderFieldFailure extends Error {}

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
    throw new ProviderFieldFailure(
      `${executable} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}

/** Throws if the shared Lima instance is missing or not Stopped. Every
 * provider run assumes the same immutable shared VM, so this is checked
 * before the run and re-checked after — independent of that provider's
 * own pass/fail outcome. */
function assertStopped() {
  const rows = command(limactlPath, ['list', '--json'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const worker = rows.find((row) => row.name === instance);
  if (!worker) throw new ProviderFieldFailure(`required Lima instance is absent: ${instance}`);
  if (worker.status !== 'Stopped') {
    throw new ProviderFieldFailure(`Lima instance is not stopped: ${worker.status}`);
  }
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
    throw new ProviderFieldFailure(
      `${provider.host} field execution failed: ${JSON.stringify(outcome)}`,
    );
  }
  if (events === 0)
    throw new ProviderFieldFailure(`${provider.host} emitted no provider-owned output`);
  if (provider.allowGuestMutation) {
    if (readFileSync(join(workspace, filename), 'utf8') !== expected) {
      throw new ProviderFieldFailure(`${provider.host} returned incorrect file content`);
    }
  } else if (!evidence.includes(expected.trim())) {
    throw new ProviderFieldFailure(`${provider.host} returned incorrect read-only result`);
  }
  const status = command('/usr/bin/git', [
    '-C',
    workspace,
    'status',
    '--porcelain',
    '-uall',
  ]).trim();
  const expectedStatus = provider.allowGuestMutation ? `?? ${filename}` : '';
  if (status !== expectedStatus) {
    throw new ProviderFieldFailure(`${provider.host} returned unexpected delta: ${status}`);
  }
  const visible = readdirSync(workspace)
    .filter((name) => name !== '.git')
    .sort();
  const expectedVisible = provider.allowGuestMutation ? filename : '';
  if (visible.join('\n') !== expectedVisible) {
    throw new ProviderFieldFailure(
      `${provider.host} returned unexpected files: ${visible.join(', ')}`,
    );
  }
  assertStopped();
  if (outcome.modelSelection !== 'supported') {
    throw new ProviderFieldFailure(
      `${provider.host} did not report its model-selection capability`,
    );
  }
  if ((provider.host === 'claude' || provider.host === 'codex') && !outcome.sessionRef) {
    throw new ProviderFieldFailure(`${provider.host} did not preserve a session reference`);
  }
  await handle.validateEvidence();
  return {
    provider: provider.host,
    status: 'PASS',
    runId: outcome.runId,
    cleanup: outcome.cleanup,
    sessionEvidence: outcome.sessionRef ? 'present' : 'unsupported-or-missing',
    usageEvidence: outcome.usage === undefined ? 'unsupported-or-missing' : 'present',
  };
}

/**
 * One provider's failure never prevents evidence collection for the others:
 * each provider is attempted independently and recorded as PASS/FAIL/BLOCKED.
 * A provider is BLOCKED (not attempted) only if the shared Lima instance is
 * no longer in a safe, known Stopped state after a prior provider's run —
 * continuing onto an unverified instance would be unsafe, not merely risky.
 */
async function runAll() {
  const results = [];
  let blocked = false;
  for (const provider of providers) {
    if (blocked) {
      results.push({
        provider: provider.host,
        status: 'BLOCKED',
        reason: 'shared Lima instance is not in a known-safe state after a prior provider run',
      });
      continue;
    }
    try {
      results.push(await runProvider(provider));
    } catch (error) {
      results.push({
        provider: provider.host,
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        assertStopped();
      } catch {
        blocked = true;
      }
    }
  }
  return results;
}

try {
  if (!existsSync(limactlPath)) throw new ProviderFieldFailure(`limactl is absent: ${limactlPath}`);
  assertStopped();
  const results = await runAll();
  const allPassed = results.every((result) => result.status === 'PASS');
  process.stdout.write(
    `${JSON.stringify({
      gate: 'cli-provider-field',
      status: allPassed ? 'PASS' : 'PARTIAL',
      results,
      instanceStatus: 'Stopped',
    })}\n`,
  );
  if (!allPassed) process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
