# Instruction precedence rules

When instructions conflict, Major and any agent it dispatches resolve them in this order
(highest first):

1. **Human decisions** recorded as resolved DecisionRequests for the task at hand.
2. **Security and permissions rules** (`security-and-permissions.md`) — these can never be
   relaxed by lower layers, only tightened.
3. **Project configuration** (the registered project's config: protected paths, prohibited
   commands, approval categories, protected branches).
4. **Active instruction registry entries** (`instructions.registry.json`) in listed order.
5. **Task description and its roadmap item.**
6. **Default engineering judgment** of the dispatched agent.

Rules:

- A lower layer may add constraints but never remove one imposed above it.
- If two entries at the same layer conflict, the more restrictive interpretation wins; if
  that is ambiguous, raise a DecisionRequest instead of guessing.
- Only entries with status `active` in the registry bind anyone. Entries marked
  `deprecated` bind no one. Entries marked `superseded` redirect to their successor via
  `supersededBy` — agents must follow the pointer and use only the successor.
- Guidance files not listed in the registry have no authority.

## Deprecating or superseding guidance

- Never delete a guidance file or registry entry; history must remain auditable.
- To retire guidance with no replacement: set its registry status to `deprecated` and add
  a dated note explaining why.
- To replace guidance: add the new file and registry entry, then mark the old entry
  `superseded` with `supersededBy` pointing at the new entry's id.
- Loader behaviour is implemented in `src/guidance/registry.ts` (`resolveCurrent` follows
  supersession chains and refuses cycles).
