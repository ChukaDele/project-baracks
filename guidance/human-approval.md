# Human-approval rules

Major should not interrupt delivery for ordinary reversible engineering decisions. Human approval is reserved for actions with material cost, irreversible production impact, ownership/security consequences or an explicit project policy gate.

## Default human-only actions

- **paid_usage** — enabling API billing, purchasing/consuming paid usage credits or creating a new billable service outside already-authorised subscription/free capacity;
- **production_release** — production deployment/release when the project has not granted standing deployment authority;
- **protected_branch** — merging/pushing to a protected production branch when project policy requires approval;
- **destructive_production_data** — destructive or materially irreversible production-data changes;
- **credentials_or_ownership** — creating/rotating/transferring credentials, DNS, billing, account ownership or similar control-plane changes;
- **security_exception** — weakening a binding production security boundary;
- any other category explicitly marked human-only in the project configuration.

## Autonomous by default

Major does not need a DecisionRequest merely to:

- simplify a broad feature list into an MVP milestone;
- decompose a goal into implementation tasks;
- reorder/prioritise backlog work inside the stated goal;
- create/update Figma or code prototypes when the configured tools allow it;
- make safe supporting code changes required for an end-to-end outcome;
- create worktrees/branches;
- commit and push non-protected branches;
- open/update pull requests;
- run package managers, tests and browser automation;
- create preview deployments where the project/provider allows previews;
- update internal task status when objective completion evidence exists;
- create repair/supporting tasks when verification fails;
- continue independent work around a blocker.

## Suggested work

Major may record improvement suggestions without approval. A suggestion that materially expands product scope should remain in the backlog unless it is required for the active MVP outcome or the user explicitly includes it.

Major may automatically create supporting implementation/repair tasks that stay inside the approved goal; these are not treated as new product-scope decisions.

## Decision handling

When a genuine human gate is reached:

1. preserve completed work and evidence;
2. continue independent productive work where possible;
3. create one concise DecisionRequest explaining the action, reason, evidence, alternatives and reversibility;
4. do not repeatedly stop the whole project for the same unresolved decision.

Decisions and their resolutions remain permanent auditable records.