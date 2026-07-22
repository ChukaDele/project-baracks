import type { DbConn } from '../db/client.js';
import { executionPolicyDecisions } from '../db/schema.js';
import { newId } from '../domain/ids.js';
import type { DecisionRecorder } from './gateway.js';

/** Persist every execution-policy decision to the append-only audit table. */
export function dbDecisionRecorder(db: DbConn): DecisionRecorder {
  return (decision) => {
    db.insert(executionPolicyDecisions)
      .values({
        id: newId('xpd'),
        kind: decision.kind,
        allowed: decision.allowed,
        executable: decision.executable,
        argvJson: JSON.stringify(decision.argv),
        cwd: decision.cwd ?? null,
        reason: decision.reason,
        strippedEnvJson: JSON.stringify(decision.strippedEnv),
        authorizedEnvJson: JSON.stringify(decision.authorizedEnv),
        envDecisionId: decision.envDecisionId ?? null,
        at: decision.at,
      })
      .run();
  };
}
