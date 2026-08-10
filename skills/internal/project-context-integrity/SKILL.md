---
name: project-context-integrity
description: Use whenever a task names, implies, links to, or references a project/repository and before cross-project edits, handoffs, migrations or fixes. Confirm that the active repo is the intended target. If the task clearly belongs to another known project, do not patch the current repo; reroute to the correct repo automatically when unambiguous, or stop and surface the mismatch when ambiguous.
---

# Project Context Integrity

The wrong repository is a hard correctness failure. A technically correct fix in the wrong project is still wrong.

## Prime rule

Before substantive edits, compare:

1. the current Git root and remote;
2. the active Major project/goal;
3. project names, URLs, paths and artifacts named in the task;
4. the destination implied by the requested behavior.

Never mutate project A merely because it is open when the request clearly belongs to project B.

## Deterministic check

When a target project is named, run:

`major project guard <target-project> --cwd "$PWD"`

- `PASS` means the active repo matches the target.
- `REROUTE` means leave the current repo untouched and move execution to the reported repo path.

Use `major project locate <target-project>` when you need only the canonical local path.

## Smart rerouting

If the target is unambiguous and Major can resolve it locally:

- preserve the user's original outcome;
- switch/delegate to that repo rather than editing the current project;
- carry only sanitized cross-project process learning, never project-private data;
- report the reroute briefly: `Rerouted <task> from <current> to <target> because the artifact belongs there.`

Do not ask the user to repeat the task merely because the wrong repo was open.

## Push back when needed

Push back instead of silently proceeding when:

- the user names one project but the requested file/URL clearly belongs to another;
- two plausible target repos exist;
- a request would copy client/PII data across boundaries;
- the requested change contradicts an established project decision and no newer instruction supersedes it;
- a migration would create a duplicate canonical implementation.

For an unambiguous safe mismatch, reroute automatically. Ask one concise question only when the target genuinely cannot be determined.

## Cross-project references

A reference implementation may be read from another project when allowed, but implementation writes stay in the target repo. Do not "fix the example" when the user asked to fix the consuming product.

## Failure conditions

This skill has failed if an agent:

- edits files in the wrong repo because that workspace happened to be open;
- creates a duplicate project inside another repo instead of locating the existing project;
- resolves a named project to `current` without checking remote identity;
- copies project-private/client data into another project to make the task easier;
- notices a project mismatch only after committing changes.

## Resolver examples

### Should trigger

- "Fix this in Surface Talent" while the current repo is JSS.
- "Use the Bredge implementation as a reference but add it to my personal site."
- "You are in the wrong project; this belongs in the other repo."
- "Move this work to the existing JSS project rather than creating another app here."

### Should not trigger

- "Rename this local component inside the current project."
- "Compare the architecture of JSS and Surface Talent without changing either."
- "Search GitHub for examples of this pattern."

### Conflicts

`project-context-integrity` wins before implementation, migration, deployment and QA skills because the correct target repo must be established first.
