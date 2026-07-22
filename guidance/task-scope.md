# Task-scope rules

- A task is the unit of dispatch: one task, one contract, one verifiable outcome. Agents
  work only on the task they were dispatched for.
- Every changed line must trace to the task's description. Adjacent refactoring,
  drive-by fixes, and speculative flexibility are out of scope; propose them as task
  suggestions (`major task suggest`) instead of doing them.
- Suggested tasks are NOT tasks. They live in `task_suggestions` and enter the task table
  only through explicit approval (`major task approve`).
- One roadmap item may fan out into many engineering tasks; a task may reference at most
  one roadmap item. Task-to-roadmap linkage is how evidence rolls up to roadmap updates.
- Dependencies gate execution: a task cannot be queued while any dependency is not
  completed. Model this with `TaskDependency` rows rather than prose.
- A task is completed only through the canonical lifecycle
  (`src/domain/lifecycle.ts`) by satisfying the completion proof set
  (`src/domain/completion.ts`): passed verification runs, resolved P0/P1 review
  findings, verified evidence relationships, and any task-specific criteria. A
  free-text evidence assertion is never sufficient, and agents cannot fabricate
  evidence references (DB-enforced). There is no other path to `completed`.
- If a task's scope turns out to be wrong (too big, ambiguous, conflicts with guidance),
  the agent stops and raises a DecisionRequest rather than improvising.
