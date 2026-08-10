---
name: major-self-maintenance
description: Use whenever Major modifies its own repository, skills, resolver, policies, runtime, installers or learning system. Never leave Major main red. Batch changes on an unopened branch, keep skill registry/evals/catalog atomic, run the complete local gate, use independent review for material behavior changes, and merge only after the exact head is green.
---

# Major Self-Maintenance

Major cannot credibly govern other projects while its own active tree is inconsistent.

## Hard invariant

**Major `main` must stay green.**

Do not push a new skill/runtime/policy directly to `main` and wait for CI to tell you whether the repository is coherent.

## Required workflow

For every material Major change:

1. Start from current green `main`.
2. Create a dedicated **unopened branch/worktree**.
3. Perform the read-only/adversarial audit first and collect the defect list before editing.
4. Implement the smallest coherent batch on that unopened branch. Do not open a PR after the first tiny fix.
5. When adding/updating an internal skill, update in the same batch:
   - `skills/internal/<skill>/SKILL.md`;
   - `guidance/skills.registry.json`;
   - resolver eval fixture when the skill is routing-critical;
   - human-readable catalog if present;
   - validator requirements when the capability is a hard invariant.
6. Run Major validator, format, lint, typecheck, full tests and production build locally when an execution environment is available.
7. Fix all locally detectable failures **before** opening the PR. GitHub Actions is a release verifier, not the iterative formatter/test runner.
8. Open the PR only when the batch is coherent. Once the PR exists, avoid one-commit/one-CI loops; consolidate fixes before the next push.
9. For changes to authority, routing, learning, project boundaries, installation or external writes, use a different provider for adversarial review.
10. Merge only the exact green head.
11. Verify the resulting `main` CI after merge.
12. If `main` is red, repair Major before adding another self-change.

## CI / Actions budget discipline

- Prefer read-only GitHub inspection while auditing.
- Branch commits do not need a PR immediately. Keep the branch unopened while batching when the workflow only runs on PRs/main.
- Do not create temporary CI-failing workflow commits just to print formatter output when local tooling can provide it.
- Re-run failed jobs only when the failure is plausibly transient. Deterministic code/format/type/test failures require a real fix before another run.
- One final PR validation plus one post-merge `main` validation is the normal target for a coherent release batch.

## Skill promotion is atomic

A skill directory alone is not a promoted skill. A reusable skill is considered promoted only when:

- registry entry exists;
- trigger language is reachable;
- required positive/negative resolver eval exists;
- installer can distribute it;
- validation is green;
- a representative real task has used it successfully when the skill changes operational behavior.

## No self-grading shortcut

Builder-authored tests are necessary but not sufficient for consequential Major changes. Use independent provider review and real-project evidence where the change affects orchestration, safety, routing, installation or learning.

## Resolver examples

### Should trigger

- "Add a new skill to Major."
- "Change how Major routes projects or tools."
- "Update Major's learning loop."
- "Fix Major itself after its CI went red."
- "Stop burning GitHub Actions on every tiny Major fix."

### Should not trigger

- "Fix a bug in JSS."
- "Review a Surface Talent candidate screen."
- "Change the Bredge hero animation."

### Conflicts

This skill governs the change process for Major itself. The specialist skill still governs the substance of the change.
