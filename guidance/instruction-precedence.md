# Instruction precedence rules

When instructions conflict, Major and any agent it dispatches resolve them in this order (highest first):

1. **Human decisions** for the task at hand.
2. **Non-negotiable safety floor** in `security-and-permissions.md`.
3. **Project configuration**: protected resources, explicit constraints and authority boundaries.
4. **Active Major guidance** in `guidance/instructions.registry.json`, in listed order.
5. **Task/goal contract and active roadmap state.**
6. **Triggered skills, workflows and external tool guidance.**
7. **Default engineering judgement** of the dispatched agent.

Rules:

- Lower layers may add useful technique but cannot silently remove or contradict higher-authority constraints.
- External/upstream skills are capability modules, not policy authorities. If a skill requires ceremony, approval, architecture or behavior that conflicts with Major's active MVP/autonomy/communication rules, adapt/wrap the skill or follow Major's higher rule.
- If two equally authoritative rules conflict materially, use the rule that better preserves the explicit user outcome and safety floor; raise a decision only when the conflict cannot be resolved safely.
- Only entries currently listed as `active` in the Major guidance registry bind agents as Major policy.
- Guidance files not in the active registry have no runtime authority.
- Major should minimise instruction volume: prefer a small number of clear current rules over layered historical prose.

## Replacing or retiring guidance

Git history is the audit archive; the active working tree is not.

When guidance is replaced:

1. write the successor rule;
2. migrate any still-valid content;
3. update the active registry to the successor;
4. verify the new loader/tests/behaviour use the successor;
5. remove the superseded file and stale registry entry from the active tree;
6. run a repository-wide stale-reference scan;
7. record a compact migration receipt when the change is materially important.

Do not keep inactive duplicate guidance, `old/`, `legacy/`, `v1-final-final`, dead feature flags, obsolete aliases or commented-out former implementations in active context merely for history. Git already preserves them.

Temporary compatibility shims are allowed only when an active consumer still needs them. They must have an owner, removal condition and expiry/review point.

The default end state of a completed migration is **one canonical current path**.