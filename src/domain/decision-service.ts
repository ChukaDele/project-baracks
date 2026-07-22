import { and, eq } from 'drizzle-orm';
import type { DbConn } from '../db/client.js';
import { decisionRequests } from '../db/schema.js';
import { newId, nowIso } from './ids.js';

export interface NewDecisionInput {
  category: string;
  question: string;
  projectId?: string;
  taskId?: string;
  contextJson?: string;
}

export function createDecisionRequest(db: DbConn, input: NewDecisionInput) {
  const row = {
    id: newId('dreq'),
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    category: input.category,
    question: input.question,
    contextJson: input.contextJson ?? null,
    status: 'open' as const,
  };
  db.insert(decisionRequests).values(row).run();
  return row;
}

export function getDecision(db: DbConn, decisionId: string) {
  const row = db.select().from(decisionRequests).where(eq(decisionRequests.id, decisionId)).get();
  if (!row) throw new Error(`decision request not found: ${decisionId}`);
  return row;
}

/** Resolve an open decision. Resolved decisions are immutable (DB trigger). */
export function resolveDecision(
  db: DbConn,
  decisionId: string,
  status: 'approved' | 'rejected',
  resolution?: string,
) {
  const result = db
    .update(decisionRequests)
    .set({ status, resolution: resolution ?? null, resolvedAt: nowIso() })
    .where(and(eq(decisionRequests.id, decisionId), eq(decisionRequests.status, 'open')))
    .run();
  if (result.changes !== 1) {
    throw new Error(`decision ${decisionId} is not open (already resolved or missing)`);
  }
  return getDecision(db, decisionId);
}

/**
 * True only when the decision exists, is approved, and matches the expected
 * category (and task, when given). Anything else — unknown id, open,
 * rejected, wrong category, wrong task — is NOT authorisation.
 */
export function isApprovedDecision(
  db: DbConn,
  decisionId: string,
  expect: { category: string; taskId?: string },
): boolean {
  const row = db.select().from(decisionRequests).where(eq(decisionRequests.id, decisionId)).get();
  if (!row) return false;
  if (row.status !== 'approved') return false;
  if (row.category !== expect.category) return false;
  if (expect.taskId !== undefined && row.taskId !== expect.taskId) return false;
  return true;
}
