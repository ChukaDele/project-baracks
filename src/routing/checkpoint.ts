import type { DbConn } from '../db/client.js';
import { routingCheckpoints, type RunPurpose } from '../db/schema.js';
import { newId } from '../domain/ids.js';
import type { RoutingDecision } from './router.js';

/**
 * Persist an explicit checkpoint record when routing cannot proceed — the
 * preferred model is unavailable or only paid (unapproved) options remain.
 * Append-only (DB triggers); the record is what a human reviews before
 * approving paid usage or waiting out an exhaustion window.
 */
export function recordRoutingCheckpoint(
  db: DbConn,
  input: {
    taskId: string;
    purpose: RunPurpose;
    decision: Extract<RoutingDecision, { kind: 'checkpoint' }>;
  },
) {
  const row = {
    id: newId('rchk'),
    taskId: input.taskId,
    purpose: input.purpose,
    reason: input.decision.reason,
    paidOptionsJson: JSON.stringify(
      input.decision.paidOptionsAvailable.map((c) => ({
        provider: c.provider,
        modelRef: c.model.modelRef,
        billingMode: c.model.billingMode,
      })),
    ),
  };
  db.insert(routingCheckpoints).values(row).run();
  return row;
}
