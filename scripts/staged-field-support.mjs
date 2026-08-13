import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../dist/db/client.js';
import { executeMajorCommand } from '../dist/security/major-gateway.js';
import {
  completeStagedCliProviderField,
  completeStagedCursorField,
  issueStagedValidationLease,
  revokeStagedValidationLease,
  stagedValidationRequestDigest,
} from '../dist/security/staged-validation.js';
import { resolveProjectForCwd } from '../dist/supervisor/state.js';
import { releaseResource, requestResource } from '../dist/supervisor/resources.js';
import { providerArgs } from '../dist/providers/commands.js';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  parseProviderEventLine,
} from '../dist/providers/evidence.js';
import { loadLimaExecutionConfig } from '../dist/execution/lima-config.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalMajorHome = join(homedir(), '.major');

for (const [name, expected] of [
  ['MAJOR_HOME', canonicalMajorHome],
  ['MAJOR_DB_PATH', join(canonicalMajorHome, 'major.db')],
  ['MAJOR_RESOURCE_PATH', join(canonicalMajorHome, 'resource-state.json')],
]) {
  if (process.env[name] && resolve(process.env[name]) !== resolve(expected)) {
    throw new Error(`staged validation refuses non-canonical ${name}`);
  }
}
process.env.MAJOR_HOME = canonicalMajorHome;
process.env.MAJOR_DB_PATH = join(canonicalMajorHome, 'major.db');
process.env.MAJOR_RESOURCE_PATH = join(canonicalMajorHome, 'resource-state.json');

function fixedWorkspace(nonce, name) {
  const path = join(canonicalMajorHome, 'staged-validation', 'workspaces', nonce, name);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    execFileSync('/usr/bin/git', ['-C', path, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      env: {},
    });
  } catch {
    execFileSync('/usr/bin/git', ['-C', path, 'init', '--initial-branch=field'], {
      encoding: 'utf8',
      env: {},
    });
  }
  return path;
}

export function stagedFieldExecutionConfig() {
  const root = resolve(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
  return loadLimaExecutionConfig(resolve(root, 'execution.json'));
}

export function stagedFieldValidationNonce() {
  const root = resolve(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
  const release = JSON.parse(readFileSync(resolve(root, 'release.json'), 'utf8'));
  const leasePath = join(
    canonicalMajorHome,
    'staged-validation',
    'authorities',
    release.sha,
    'major-staged-validation-lease.json',
  );
  const nonce = JSON.parse(readFileSync(leasePath, 'utf8')).validationNonce;
  if (!/^[a-f0-9-]{36}$/.test(nonce ?? '')) {
    throw new Error('GitHub staged-validation authority has no valid field nonce');
  }
  return nonce;
}

/**
 * Product-owned staged field entry. Callers supply a complete fixed request,
 * not a lease or global activation flag. This function issues, admits and
 * closes one exact-SHA validation lease around that single request.
 */
function executeStagedFieldCase({
  request,
  caseId,
  expectedEvidence,
  expectedExecutionStatus,
  predecessorLeaseId,
  validationNonce,
}) {
  if (!['provider-field', 'clean-install'].includes(caseId)) {
    throw new Error(`field harness cannot issue staged case: ${caseId}`);
  }
  if (
    !request.providerRequest ||
    request.providerRequest.approvalAuthority.decisions.length !== 0
  ) {
    throw new Error('field validation cannot mint provider action approval authority');
  }
  const releaseRoot = resolve(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
  const release = JSON.parse(readFileSync(resolve(releaseRoot, 'release.json'), 'utf8'));
  const releaseSha = release.sha;
  const releaseBranch = release.branch;
  const releaseRepository = release.repository;
  const manifestPath = resolve(releaseRoot, 'runtime-manifest.json');
  const releaseManifestHash = sha256(readFileSync(manifestPath));
  const releaseTreeHash = release.treeHash;
  execFileSync(
    process.execPath,
    [resolve(releaseRoot, 'scripts/major-runtime-manifest.mjs'), 'verify', releaseRoot],
    {
      encoding: 'utf8',
      env: {},
    },
  );
  const project = resolveProjectForCwd(request.cwd);
  const projectIdentityHash = sha256(project?.project ?? `local:${resolve(request.cwd)}`);
  const projectRootHash = sha256(realpathSync(request.cwd));
  const workerId = `staged-field-${process.pid}-${randomUUID()}`;
  const processNonce = randomUUID();
  const resource = requestResource({
    kind: 'worker',
    owner: workerId,
    project: project?.project ?? 'release-validation',
    pid: process.pid,
    ttlMs: Math.min(request.timeoutMs ?? 300_000, 25 * 60 * 1000) + 60_000,
  });
  if (resource.status !== 'active') {
    throw new Error(`staged validation worker resource is ${resource.status}`);
  }
  const opened = openDb();
  let leaseId;
  try {
    const requestDigest = stagedValidationRequestDigest(request);
    const secret = issueStagedValidationLease(opened.db, {
      releaseRepository,
      releaseSourceCheckout: release.sourceCheckout,
      releaseRoot,
      releaseBranch,
      releaseSha,
      releaseTreeHash,
      releaseManifestHash,
      provider: request.providerRequest.host,
      projectIdentityHash,
      projectRootHash,
      caseId,
      requestDigest,
      expectedEvidenceHash: sha256(expectedEvidence),
      expectedExecutionStatus,
      validationNonce,
      workerId,
      processNonce,
      resourceLeaseId: resource.lease.id,
      ...(predecessorLeaseId ? { predecessorLeaseId } : {}),
      leaseMs: Math.min(request.timeoutMs ?? 300_000, 25 * 60 * 1000) + 60_000,
    });
    leaseId = secret.leaseId;
    const authority = {
      kind: 'staged_validation',
      leaseId: secret.leaseId,
      token: secret.token,
      requestDigest,
      releaseSha,
      workerId,
      processNonce,
    };
    const handle = executeMajorCommand({
      ...request,
      resourceLeaseId: resource.lease.id,
      stagedValidationAuthority: authority,
    });
    const outcome = handle.outcome.finally(() => releaseResource(resource.lease.id));
    const capturedEvents = [];
    const events = (async function* () {
      for await (const event of handle.events) {
        capturedEvents.push(event);
        yield event;
      }
    })();
    return {
      validationLeaseId: secret.leaseId,
      events,
      cancel: () => handle.cancel(),
      outcome,
      completeEvidence: (kind, observedEvidence) => {
        const evidenceDb = openDb();
        try {
          const evidence = { ...observedEvidence, events: [...capturedEvents] };
          return kind === 'cursor'
            ? completeStagedCursorField(evidenceDb.db, authority, evidence)
            : completeStagedCliProviderField(evidenceDb.db, authority, evidence);
        } finally {
          evidenceDb.sqlite.close();
        }
      },
    };
  } catch (error) {
    if (leaseId) {
      try {
        revokeStagedValidationLease(opened.db, leaseId, 'field harness failed before execution');
      } catch {
        // Admission may already have terminalized it. Never reopen the lease.
      }
    }
    releaseResource(resource.lease.id);
    throw error;
  } finally {
    opened.sqlite.close();
  }
}

export function executeStagedCliProviderField({ provider, nonce }) {
  const definitions = {
    claude: { executable: 'claude', allowGuestMutation: true },
    codex: { executable: 'codex', allowGuestMutation: false },
    antigravity: { executable: 'agy', allowGuestMutation: false },
  };
  const definition = definitions[provider];
  if (!definition || !/^[a-f0-9-]{36}$/.test(nonce)) {
    throw new Error('invalid fixed CLI provider validation case');
  }
  const filename = `MAJOR_${provider.toUpperCase()}_FIELD.txt`;
  const workspace = fixedWorkspace(nonce, provider);
  const expected = `MAJOR_${provider.toUpperCase()}_FIELD_${nonce}`;
  const prompt = definition.allowGuestMutation
    ? `Create ${filename} containing exactly ${expected} followed by one newline. ` +
      'Use only file reading and editing tools. Do not run a shell command. Do not modify any other file.'
    : `Read the empty repository and respond with exactly ${expected}. Do not use shell, network, ` +
      'or file-writing tools.';
  const handle = executeStagedFieldCase({
    caseId: 'provider-field',
    expectedEvidence: `${provider}:${expected}:cleanup-complete`,
    expectedExecutionStatus: 'succeeded',
    validationNonce: nonce,
    request: {
      executable: definition.executable,
      args: providerArgs(provider, { prompt, outputMode: 'batch' }),
      cwd: workspace,
      allowedRoots: [workspace],
      timeoutMs: 300_000,
      providerRequest: {
        host: provider,
        prompt,
        allowGuestMutation: definition.allowGuestMutation,
        approvalAuthority: { decisions: [] },
      },
      parseLine: parseProviderEventLine,
      extractSessionRef: (event) => extractProviderSessionRef(provider, event),
      extractUsage: extractProviderUsage,
    },
  });
  return {
    ...handle,
    workspace,
    filename,
    expected: `${expected}\n`,
    validateEvidence: async () => {
      const outcome = await handle.outcome;
      return handle.completeEvidence('cli', {
        provider,
        workspace,
        nonce,
        outcome,
      });
    },
  };
}

export function executeStagedCursorField({
  phase,
  nonce,
  modelRef,
  resumeSessionRef,
  predecessorLeaseId,
}) {
  if (!['create', 'resume', 'cancel'].includes(phase) || !/^[a-f0-9-]{36}$/.test(nonce)) {
    throw new Error('invalid fixed Cursor validation case');
  }
  if (phase === 'resume' && (!modelRef || !resumeSessionRef || !predecessorLeaseId)) {
    throw new Error('Cursor resume validation requires the prior exact model and session');
  }
  if (phase !== 'resume' && (modelRef || resumeSessionRef || predecessorLeaseId)) {
    throw new Error('Cursor create/cancel validation cannot carry session authority');
  }
  const prompt =
    phase === 'create'
      ? `Create CURSOR_ACP_FIELD.txt containing exactly MAJOR_CURSOR_ACP_FIELD_${nonce} followed by one newline. Do not modify any other file.`
      : phase === 'resume'
        ? `Continue this session. Create CURSOR_ACP_RESUME.txt containing exactly MAJOR_CURSOR_ACP_RESUME_${nonce} followed by one newline. Do not modify any other file.`
        : 'Analyze the repository in depth and prepare a long architecture report. Do not modify files or run shell commands.';
  const workspace = fixedWorkspace(nonce, phase === 'cancel' ? 'cursor-cancel' : 'cursor-success');
  const handle = executeStagedFieldCase({
    caseId: 'provider-field',
    expectedEvidence: `cursor:${phase}:${nonce}:cleanup-complete`,
    expectedExecutionStatus: phase === 'cancel' ? 'cancelled' : 'succeeded',
    validationNonce: nonce,
    ...(predecessorLeaseId ? { predecessorLeaseId } : {}),
    request: {
      executable: 'cursor-agent',
      args: ['acp'],
      cwd: workspace,
      allowedRoots: [workspace],
      timeoutMs: phase === 'cancel' ? 120_000 : 240_000,
      providerRequest: {
        host: 'cursor',
        prompt,
        allowGuestMutation: true,
        approvalAuthority: { decisions: [] },
        ...(modelRef ? { modelRef } : {}),
        ...(resumeSessionRef ? { resumeSessionRef } : {}),
      },
    },
  });
  return {
    ...handle,
    workspace,
    validateEvidence: async () => {
      const outcome = await handle.outcome;
      return handle.completeEvidence('cursor', {
        phase,
        workspace,
        nonce,
        outcome,
        ...(resumeSessionRef ? { expectedSessionRef: resumeSessionRef } : {}),
        ...(modelRef ? { expectedModel: modelRef } : {}),
      });
    },
  };
}
