import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { verifyProviderDecision } from '../src/security/major-gateway.js';
import { providerActionDigest } from '../src/security/provider-approval-policy.js';

let root = '';
let priorDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-provider-decision-'));
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
});

afterEach(() => {
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  rmSync(root, { recursive: true, force: true });
});

function repo(owner: string): string {
  const path = join(root, owner, 'shared');
  mkdirSync(join(path, '.git'), { recursive: true });
  writeFileSync(
    join(path, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/${owner}/shared.git\n`,
  );
  return path;
}

describe('provider DecisionRequest authority', () => {
  it('requires approved, unexpired authority scoped to provider and canonical project', () => {
    const jss = repo('OwnerA');
    const other = repo('OwnerB');
    const opened = openDb();
    const actionDigest = providerActionDigest({ kind: 'execute', rawInput: 'pnpm test' });
    const decision = createDecisionRequest(opened.db, {
      category: 'command_execution',
      question: 'Allow one controlled validation command?',
      contextJson: JSON.stringify({
        scope: {
          provider: 'cursor',
          purpose: 'provider-action:github.com/ownera/shared',
          actionDigest,
        },
      }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      verifyProviderDecision({
        cwd: jss,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: decision.id,
        actionDigest,
        consumerId: 'run-before-approval',
      }),
    ).toBe(false);
    resolveDecision(opened.db, decision.id, 'approved', 'test approval');
    opened.sqlite.close();

    expect(
      verifyProviderDecision({
        cwd: jss,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: decision.id,
        actionDigest,
        consumerId: 'run-1',
      }),
    ).toBe(true);
    expect(
      verifyProviderDecision({
        cwd: other,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: decision.id,
        actionDigest,
        consumerId: 'run-2',
      }),
    ).toBe(false);
    expect(
      verifyProviderDecision({
        cwd: jss,
        provider: 'claude',
        category: 'command_execution',
        decisionId: decision.id,
        actionDigest,
        consumerId: 'run-3',
      }),
    ).toBe(false);
    expect(
      verifyProviderDecision({
        cwd: jss,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: decision.id,
        actionDigest,
        consumerId: 'run-replay',
      }),
    ).toBe(false);
  });
});
