# Task-scope rules

Major scopes work around **verifiable end-to-end outcomes**, not artificially narrow implementation fragments.

- A task is one bounded user-visible or operational outcome with a clear completion condition.
- When a request contains many features, first apply the MVP prioritisation rules: identify the smallest feature set that proves the core value, then create tasks around that vertical slice.
- One roadmap item may fan out into parallel engineering tasks when that shortens the critical path, but the tasks should recombine into a working end-to-end milestone rather than remain isolated layers.
- Model real dependencies explicitly with `TaskDependency` rows rather than prose. Parallelise work that is genuinely independent.
- Agents may make **safe adjacent changes required to make the assigned outcome work correctly**, including root-cause fixes, contract adjustments, small refactors, tests and recovery paths. Do not require a separate approval/task for every supporting edit.
- Unrelated product features, speculative abstractions and broad opportunistic rewrites remain out of scope; propose them separately.
- If a blocker affects one branch of work, continue independent productive work rather than stalling the whole goal.
- After two materially unchanged failed approaches, change strategy, isolate the failing boundary or escalate to a stronger/specialist worker. Do not repeat the same repair loop indefinitely.
- Completion requires objective evidence appropriate to the outcome: E2E/browser behaviour, deterministic tests, persisted state, provider response, generated artefact, deployment result or explicit human acceptance where needed. Agent self-report is never sufficient.
- A local component or layer being complete does not prove the task complete when the requested outcome is end to end.
- If the original scope is unnecessarily broad, Major should simplify it to the MVP and explain the cut briefly. If the outcome itself is genuinely ambiguous or conflicts with a human decision, request clarification rather than inventing the goal.
