# Task lifecycle

Canonical statuses (defined in `src/domain/lifecycle.ts`, stored only on `tasks.status`):

```
suggested → draft → ready → queued → running → verifying → reviewing → ready_to_merge → completed
```

with `repairing`, `needs_decision`, `failed`, `cancelled` as the working/exception states.

```mermaid
stateDiagram-v2
    [*] --> suggested
    suggested --> draft: approve suggestion
    suggested --> cancelled: reject
    draft --> ready
    ready --> queued: all dependencies completed
    ready --> draft
    queued --> running
    queued --> ready: dequeue
    running --> verifying
    verifying --> reviewing: verification passed
    verifying --> repairing: verification failed
    reviewing --> ready_to_merge: review clean
    reviewing --> repairing: findings to fix
    repairing --> verifying: repair applied
    ready_to_merge --> completed: evidence + human merge approval
    ready_to_merge --> repairing
    needs_decision --> ready
    needs_decision --> queued
    needs_decision --> repairing
    needs_decision --> ready_to_merge
    failed --> queued: retry
    completed --> [*]
    cancelled --> [*]
```

(`running`, `verifying`, `reviewing`, `repairing`, `ready_to_merge` can each also reach
`needs_decision`, `failed`, or `cancelled`; omitted above for readability.)

## Guarded transitions

- **ready → queued** requires zero incomplete dependencies (`TaskDependency` rows whose
  target is not `completed`).
- **→ completed** requires at least one Evidence record. There is no evidence-free path
  to completion, mirroring the roadmap rule that nothing is marked Done without evidence.

Both guards refuse when the guard data wasn't supplied, so the service layer
(`transitionTask`) is the only practical entry point.

## Suggested vs. real tasks

`suggested` is represented by a `task_suggestions` row, not a `tasks` row. Approving a
suggestion performs the `suggested → draft` transition by materialising the task (linked
back via `suggestionId`/`approvedTaskId`); rejecting it never touches the tasks table.
This keeps unapproved ideas out of every task query by construction.
