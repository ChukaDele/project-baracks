---
name: learning-capture
description: Use when the user explicitly corrects agent behavior, says a mistake has happened before, identifies a recurring failure, or a reusable procedure succeeds. Fix the current task first, then capture the lesson and decide whether it stays project-local, becomes global guidance, or should be skillified.
---

# Learning Capture

An explicit user correction is a **high-value learning event**. Do not merely acknowledge it and rely on chat memory.

## Order of operations

1. **Fix the real task first.** Do not pause the user's P0 to build learning infrastructure.
2. Capture the correction/procedure before ending the task:
   `major learn capture --source user-correction --summary "..." --scope <project|global> --evidence "..."`
3. Classify the lesson.
4. If it is a stable reusable procedure, run `skillify` after the working fix is proven.
5. Verify the resolver can reach the new/updated skill on the next representative task.

## Scope classification

### Project-local

Keep the lesson in the project when it depends on:

- client/candidate/user data;
- one product's business rules;
- a provider/account/configuration unique to the project;
- a temporary project-specific workaround.

### Global

Promote only sanitized lessons that are:

- useful across multiple projects;
- stable enough to express without project secrets;
- causally connected to the failure/success;
- specific enough to change future behavior.

Examples: local dev-port coordination, primary-source fallback, exact-head review, or a repeatable CI recovery pattern.

### Policy vs skill vs memory

- **Policy/guidance** when the lesson is a durable behavioral constraint.
- **Tested skill** when the lesson is a reusable procedure with triggers and acceptance evidence.
- **Memory/candidate** when useful context exists but the procedure is not yet proven/stable enough.

## Recurrence rule

A repeated explicit correction should increase the candidate's occurrence count rather than creating duplicate notes. Repeated candidates are strong evidence to prioritize Skillify.

A single correction may be skillified immediately when the procedure is deterministic, cross-project, already proven in prior work, and cheap to validate.

## Evidence

Useful evidence includes:

- the user's explicit correction;
- failing/successful runtime behavior;
- a screenshot/log that demonstrates the failure;
- the exact fix and post-fix verification;
- prior project occurrences without sensitive data.

Do not store secrets, candidate/client PII or raw private content in global learning evidence.

## Resolver examples

### Should trigger

- "We fixed this localhost problem before. Why is the agent doing it again?"
- "Stop using that workflow across my projects; remember the correct one."
- "This is the third time the CI agent has repeated the same bad recovery step."

### Should not trigger

- "Fix this TypeScript error."
- "Make the hero headline 10% smaller."
- "What did the test failure mean?"

### Conflicts

- `skillify` packages a proven reusable procedure; `learning-capture` owns harvesting and classifying the lesson first.
- `data-learning-loop` concerns product/outcome data learning; this skill concerns agent/process learning from corrections and repeated execution patterns.
