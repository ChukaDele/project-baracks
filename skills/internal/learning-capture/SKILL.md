---
name: learning-capture
description: Use when the user explicitly corrects agent behavior, says a mistake has happened before, identifies a recurring failure, or a reusable procedure succeeds. Fix the current task first, then capture the lesson and decide whether it stays project-local, becomes global guidance, or should be skillified.
---

# Learning Capture

An explicit user correction is a **high-value learning event**. Do not merely acknowledge it and rely on chat memory.

## Start-of-task recall

Before substantive work, inspect the project's `LEARNINGS.md` and relevant `major learn list --project current` candidates. A fresh worker lacking chat history is not an excuse to repeat a durable correction.

If session context marks a candidate `REVIEW-DUE`, it has already recurred at least twice and may not be silently ignored.

## Order of operations

1. **Fix the real task first.** Do not pause the user's P0 to build learning infrastructure.
2. Verify the fix with evidence appropriate to the task.
3. Capture the correction/procedure before ending the task without waiting for the user to request it.
4. Use one stable `--key` for the same failure/procedure class across runs so paraphrases coalesce into one candidate.
5. Classify the lesson.
6. If it is a stable reusable procedure, run `skillify` after the working fix is proven.
7. Verify the resolver can reach the new/updated skill on the next representative task.
8. Mark the candidate promoted only after the durable replacement exists and is evidenced.

Default to project scope when the evidence comes from a concrete project. Use `--scope global` at capture time only when **both** the summary and evidence are already sanitized cross-project statements.

Example project capture:

`major learn capture --source user-correction --key wrong-project-edit --summary "Confirm the target repo before edits and reroute when the named project differs" --scope project --evidence "Corrected and verified in the real task"`

## Stable learning keys

A stable key is a short kebab-case identifier for the underlying behavior, not the wording of one complaint.

Good:

- `wrong-project-edit`
- `remote-preview-not-localhost`
- `mcp-installed-is-not-operational`
- `qa-browser-evidence-required`

Bad:

- a sentence copied from the user's message;
- a candidate/client/person name;
- a timestamp;
- a key containing private project data.

When the same behavior happens again, reuse the key even if the summary wording changes.

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

Examples: project/repo context integrity, primary-source fallback, exact-head review, MCP truth-state verification, remote-first previews, or a repeatable CI recovery pattern.

Project-scoped captures do **not** merge into an existing global candidate merely because they share a key. This prevents project-local evidence from leaking into global learning.

### Policy vs skill vs memory

- **Policy/guidance** when the lesson is a durable behavioral constraint.
- **Tested skill** when the lesson is a reusable procedure with triggers and acceptance evidence.
- **Memory/candidate** when useful context exists but the procedure is not yet proven/stable enough.

## Recurrence rule

A repeated explicit correction should increase the candidate's occurrence count rather than creating duplicate notes within the same scope.

**At two occurrences, the candidate may no longer be silently ignored.** Before the task closes, either:

- promote it to project guidance, global guidance or a tested skill; or
- dismiss it with explicit evidence explaining why it is unstable, unsafe to globalize, obsolete or intentionally project-specific.

Use:

- `major learn review --project current` to list recurring candidates requiring a decision;
- project promotion: `major learn promote --id <id> --scope project --evidence "<durable replacement/evidence>"`;
- global promotion: `major learn promote --id <id> --scope global --summary "<sanitized reusable lesson>" --evidence "<sanitized durable replacement/evidence>"`;
- `major learn dismiss --id <id> --evidence "<why this candidate should not be promoted>"` when the non-promotion decision is deliberate and evidenced.

Global promotion requires a sanitized summary and evidence. Major removes project/repo metadata and prior project-local evidence from the promoted global receipt.

A single correction may be skillified immediately when the procedure is deterministic, cross-project, already proven in prior work, and cheap to validate.

## Cross-project promotion

Cross-project learning means transferring the **sanitized procedure or invariant**, not copying project data. Examples:

- Bredge motion/zoom failure → responsive-motion skill usable by any website;
- Surface Talent/JSS wrong-repo mistake → project-context-integrity skill;
- repeated MCP auth/exposure confusion → mcp-integration-ops;
- recurring visual QA gaps → verify-in-browser.

Never promote candidate names, CVs, interview transcripts, client credentials or private project content into global learning.

## Evidence

Useful project-local evidence includes:

- the user's explicit correction;
- failing/successful runtime behavior;
- a screenshot/log that demonstrates the failure;
- the exact fix and post-fix verification;
- prior project occurrences.

Global evidence must be a sanitized statement that proves the durable replacement without including secrets, candidate/client PII, raw private content or private paths.

## Resolver examples

### Should trigger

- "We fixed this localhost problem before. Why is the agent doing it again?"
- "Stop using that workflow across my projects; remember the correct one."
- "This is the third time the CI agent has repeated the same bad recovery step."
- "You are editing the wrong repo again; this should have been learned already."

### Should not trigger

- "Fix this TypeScript error."
- "Make the hero headline 10% smaller."
- "What did the test failure mean?"

### Conflicts

- `skillify` packages a proven reusable procedure; `learning-capture` owns harvesting and classifying the lesson first.
- `data-learning-loop` concerns product/outcome data learning; this skill concerns agent/process learning from corrections and repeated execution patterns.
