---
name: skillify
description: Use after a novel workflow succeeds or a recurring failure is solved and the procedure is likely to recur. Convert the working procedure into a tested reusable skill pack instead of adding more permanent orchestration code or raw memory.
---

# Skillify

Use **after the real task works**. Do not pause an active P0 merely to create infrastructure.

Major's GBrain lifecycle may capture a bounded structured workflow from the final worker result. A single observation stays a project-local candidate. Semantically recurring, independently validated procedures may be synthesized and promoted automatically when they do not overlap an existing skill. Project evidence never becomes a global generated skill directly.

## Decide whether to skillify

Skillify when the lesson is:

- likely to recur across tasks/projects;
- difficult enough that agents may repeat the same mistake;
- stable enough to express as a procedure/contract;
- safe to reuse without leaking client/project-specific data.

Do not skillify trivial one-offs, project secrets, candidate/client data, or speculative procedures that have not worked yet.

## Skill pack

A durable skill pack should contain only what is needed:

1. `SKILL.md` — intent, judgment, trigger conditions, procedure and stop conditions.
2. Minimal deterministic code — only for I/O, parsing, retrieval, transformations, validation or operations that should not hallucinate.
3. Unit tests for deterministic code when present.
4. Skill eval — representative tasks that should succeed when the skill is followed.
5. Resolver eval — positive triggers, negative triggers and near-neighbour/conflict cases.
6. Integration smoke test across the markdown + deterministic code boundary when code exists.
7. Filing/memory rules — what is reusable globally vs what must remain project-local.

## Resolver examples

Every new skill should document:

### Should trigger

At least 3 representative prompts/tasks.

### Should not trigger

At least 3 plausible near-neighbour prompts where loading the skill would be noise or harmful.

### Conflicts

Name overlapping skills and state which one wins or how they compose.

## Thin-code rule

Prefer markdown judgment. Add code only for parts that benefit from determinism.

Good code candidates:

- retrieval/filter/dedupe/ranking primitives;
- structured parsing;
- file/media conversion;
- provider adapters;
- validation/evidence checks;
- repeatable state mutations.

Do not encode an entire agent workflow in TypeScript/Python merely because it can be coded.

## Validation

Before promotion to the recurring Major skill library:

- establish the unchanged baseline before an optimization;
- apply one bounded candidate mutation and compare it on at least three representative repeated runs, reporting the median cost and latency; treat differences within 5% as inconclusive and require a predeclared material-improvement threshold;
- use held-out tasks when the candidate bundles a mutation, and check expected evaluation cost before running it;
- version every accepted change, retain a tested rollback target, and monitor field outcomes for regression after activation;
- run deterministic tests;
- run resolver positive/negative cases;
- run one integration/E2E example;
- use an independent reviewer for consequential skills;
- verify the skill does not duplicate an existing capability.

A successful real procedure remains a **candidate skill** until these checks pass. Correlation is not causal evidence, and one observation cannot create durable policy. Without mutation authority, return the proposed skill change and evidence plan without applying or promoting it.

## Immediate availability after promotion

A skill that exists in git but is not visible to the active resolver is not finished.

For a global/internal skill change that lands on `main`:

1. keep the executable Major release immutable;
2. activate the current validated skill bundle with `major skill sync`;
3. rerun `major skill audit --strict`;
4. resolve at least one positive trigger for the new/changed skill;
5. do not require a Lima/runtime reinstall merely to make markdown knowledge current.

The hot bundle is the mutable knowledge layer. It must contain the registry, internal skill tree and resolver evals from one exact commit and activate as a unit. Never copy a single `SKILL.md` into a live global directory and call it installed.

If hot sync is unavailable because the installed Major predates that capability, perform one normal validated Major runtime install; subsequent skill-only updates should use hot sync.

## Automatic lifecycle

1. Emit a bounded `workflow` object only after the procedure succeeds.
2. Major compares task concepts and action structure with project-local candidates.
3. One-offs remain candidates. Recurrence and distinct task evidence are mandatory.
4. If an existing skill fits, hold the candidate for that skill's next version. Do not create a near-duplicate.
5. Synthesize the smallest Agent Skills compatible `SKILL.md`.
6. Validate its name, description and operational sections before activation.
7. Route active project skills through the canonical resolver.
8. For a global/internal promotion merged to `main`, hot-sync the validated bundle and prove resolver reachability before declaring the promotion usable.
9. Record success, failure, duration and cost when available.
10. Monitor field cost, latency and outcomes against the baseline. Repeated poor outcomes roll back or deprecate the skill from default routing without deleting provenance.

Automatic promotion is project-local. Global promotion still uses Major's existing sanitized learning review and cross-project policy.

## Learning priority

Prefer:

`deterministic rule/tool → tested skill → memory`

Rules prevent. Skills institutionalize. Memory reminds.
