---
name: major-self-maintenance
description: Use whenever Major modifies its own repository, skills, resolver, policies, runtime, installers or learning system. Never leave Major main red. Make changes on a branch/PR, keep skill registry/evals/catalog atomic, run the complete gate, use independent review for material behavior changes, and merge only after the exact head is green.
---

# Major Self-Maintenance

Major cannot credibly govern other projects while its own active tree is inconsistent.

## Hard invariant

**Major `main` must stay green.**

Do not push a new skill/runtime/policy directly to `main` and wait for CI to tell you whether the repository is coherent.

## Required workflow

For every material Major change:

1. Start from current green `main`.
2. Create a dedicated branch/worktree.
3. Implement the smallest coherent change.
4. When adding/updating an internal skill, update in the same branch:
   - `skills/internal/<skill>/SKILL.md`;
   - `guidance/skills.registry.json`;
   - resolver eval fixture when the skill is routing-critical;
   - human-readable catalog if present;
   - validator requirements when the capability is a hard invariant.
5. Run Major validator, format, lint, typecheck, full tests and production build.
6. Open/update a PR.
7. For changes to authority, routing, learning, project boundaries or external writes, use a different provider for adversarial review.
8. Merge only the exact green head.
9. Verify `main` CI after merge.
10. If `main` is red, repair Major before adding another self-change.

## Skill promotion is atomic

A skill directory alone is not a promoted skill. A reusable skill is considered promoted only when:

- registry entry exists;
- trigger language is reachable;
- required positive/negative resolver eval exists;
- installer can distribute it;
- validation is green;
- a representative real task has used it successfully when the skill changes operational behavior.

## No self-grading shortcut

Builder-authored tests are necessary but not sufficient for consequential Major changes. Use independent provider review and real-project evidence where the change affects orchestration, safety, routing or learning.

## Resolver examples

### Should trigger

- "Add a new skill to Major."
- "Change how Major routes projects or tools."
- "Update Major's learning loop."
- "Fix Major itself after its CI went red."

### Should not trigger

- "Fix a bug in JSS."
- "Review a Surface Talent candidate screen."
- "Change the Bredge hero animation."

### Conflicts

This skill governs the change process for Major itself. The specialist skill still governs the substance of the change.
