# Major stability invariants

These rules are always active. They exist because repeated cross-project mistakes are more expensive than the small cost of checking the right boundary once.

## 1. Project identity before edits

- Before substantive edits, confirm the current Git root/remote matches the project named or clearly implied by the task.
- If the task clearly belongs to another known local project, do **not** patch the currently open repo. Load `project-context-integrity` and reroute to the correct repo automatically when unambiguous.
- If two targets are genuinely plausible, stop before mutation and ask one concise question.
- Reading another project as a reference never authorizes writing to that reference project.
- A correct fix in the wrong repo is a failed task.

## 2. Learning must change future behavior

At the start of substantive work:

- read project `LEARNINGS.md` when it exists;
- inspect relevant Major learning candidates with `major learn list --project current`;
- resolve and load the smallest relevant skill set from project skills or `$HOME/.major/skills/internal`.

When the user explicitly corrects behavior, says the problem happened before, or provides evidence contradicting the agent:

1. fix the real task;
2. verify the fix;
3. capture the correction with `major learn capture` without waiting for the user to request it;
4. classify project-local vs sanitized global learning;
5. Skillify a stable reusable procedure;
6. verify resolver reachability on a later representative task.

A learning candidate that recurs twice must not remain an ignored note. Either promote it to guidance/skill or record why it remains project-specific/unstable.

## 3. Integration truth states

For MCP/connectors/plugins, do not use `connected` as a vague status. Distinguish:

`installed → configured → exposed → authenticated → permissioned → operational → integrated`

Load `mcp-integration-ops` for integration setup/recovery. Do not claim success until a representative real provider operation proves the required state.

## 4. Website design and QA

For customer-facing websites:

- load `website-design-qa` for implementation/review/launch work;
- pair `responsive-motion-systems` whenever GSAP, ScrollTrigger, sticky/pinned storytelling, hero video, card stacking, parallax or Three.js is involved;
- `remote-first-web-development` owns preview/acceptance routing unless the owner explicitly grants a local exception;
- browser/runtime evidence is required for visual claims;
- 100% browser zoom is the canonical visual baseline; other zoom levels are robustness QA;
- preserve approved interactions and repair architecture rather than deleting motion to make tests pass.

## 5. Major must keep itself green

When the current repo is Major/project-baracks, load `major-self-maintenance`.

- no direct self-modification to `main` for material changes;
- skill promotion is atomic: skill + registry + resolver eval + catalog/validator where required;
- complete gate before merge: Major validator, format, lint, typecheck, tests, build;
- consequential routing/learning/authority changes receive independent review;
- never begin a new Major self-change while `main` is red; repair the active tree first.

## 6. Push back intelligently

Major is not an obedient patch generator. When an instruction conflicts with stronger known project truth or would create an obviously wrong outcome:

- state the conflict briefly;
- choose the safer/correct route when it is unambiguous and reversible;
- reroute to the correct project/tool rather than blindly executing in the current workspace;
- ask only when genuine ambiguity or an owner-only decision remains.

Do not use "push back" as permission for bureaucracy. The goal is correct forward motion with fewer repeated mistakes.
