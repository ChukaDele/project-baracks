import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { resolveDecision } from '../src/domain/decision-service.js';
import { decideCursorPermission } from '../src/execution/cursor-acp-runtime.js';
import { verifyProviderDecision } from '../src/security/major-gateway.js';
import { providerActionDigest } from '../src/security/provider-approval-policy.js';
import { captureProviderApprovalRequest } from '../src/supervisor/worker.js';

let root = '';
let priorDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-approval-capture-'));
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(
    join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/Owner/project.git\n',
  );
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
});

afterEach(() => {
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  rmSync(root, { recursive: true, force: true });
});

describe('provider approval capture', () => {
  it('turns a denied Cursor digest into one exact durable approval without exposing raw input', () => {
    const action = {
      kind: 'execute' as const,
      name: 'Shell',
      title: 'Run authenticated command',
      rawInput: { command: 'tool --token secret-value', target: 'safe' },
    };
    const actionDigest = providerActionDigest(action);
    const captured = captureProviderApprovalRequest({
      cwd: root,
      host: 'cursor',
      data: { outcome: 'approval_required', category: 'command_execution', actionDigest },
    }) as { decisionId: string; actionDigest: string };
    expect(JSON.stringify(captured)).not.toContain('secret-value');

    const opened = openDb();
    resolveDecision(opened.db, captured.decisionId, 'approved', 'owner approved exact action');
    opened.sqlite.close();
    expect(
      verifyProviderDecision({
        cwd: root,
        provider: 'cursor',
        category: 'command_execution',
        decisionId: captured.decisionId,
        actionDigest: captured.actionDigest,
        consumerId: 'captured-run',
      }),
    ).toBe(true);
    const decisions = [
      {
        category: 'command_execution' as const,
        decisionId: captured.decisionId,
        actionDigest: captured.actionDigest,
      },
    ];
    expect(decideCursorPermission(action, { decisions }, [...decisions]).outcome).toBe('automatic');
  });
});
