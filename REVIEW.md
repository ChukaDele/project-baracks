# Review policy

Review the exact candidate and report findings before summaries. Use only these severities;
severity reflects impact, not effort:

- **BLOCKER:** unsafe authority/security boundary, destructive data risk, broken core path,
  material regression, or false acceptance/readiness claim. Blocks validation and promotion.
- **IMPORTANT:** evidenced defect or maintainability risk that must be triaged and recorded.
  It does not automatically block a usable and safe MVP; record the disposition and follow-up.
- **NIT:** polish, clarity, or optional improvement. Never blocks validation or promotion.

Speculation and questions are not findings and never block. Label them explicitly and promote
them to `BLOCKER` or `IMPORTANT` only after evidence establishes an actionable defect.

Small low-risk work may use deterministic acceptance evidence with no separate reviewer.
Substantive ordinary work gets focused review. Authority, security, irreversible, or broad-impact
changes require independent exact-head review. Any code change after review invalidates the
verdict; review the new exact head again.

A candidate is `PROMOTABLE` when its required pre-promotion evidence and selected review pass
with no `BLOCKER` findings. `PROMOTABLE` permits the merge/install path; it does not claim
installation or READY. IMPORTANT findings remain recorded triage and do not automatically block.
