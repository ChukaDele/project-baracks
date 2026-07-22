# Human-approval rules

Some decisions are never made autonomously. Each is a DecisionRequest with a category
from the project's `approvalCategories`; the defaults are:

- **paid_usage** — spending usage credits or API billing on any model.
- **merge** — merging any branch into a protected branch.
- **deploy** — any deployment or release action.
- **roadmap_done** — marking a roadmap item Done in the source of truth.
- **security_exception** — any relaxation of a security or permissions rule.

Rules:

- Work that reaches one of these gates transitions the task to `needs_decision` and
  creates an open DecisionRequest with enough context to decide (what, why, evidence,
  alternatives).
- No action in a gated category proceeds until the DecisionRequest is `approved`; a
  rejection routes the task to `repairing`, `failed`, or `cancelled` as appropriate.
- Approvals are per-instance, not standing: approving one paid run approves that run
  only.
- Suggested tasks are their own gate: suggestions become tasks only via
  `major task approve` / `major task reject`.
- Decisions and their resolutions are permanent records; they are never edited after
  resolution.
