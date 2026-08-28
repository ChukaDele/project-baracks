# Review policy

Review the exact candidate and report findings before summaries. Use only these severities;
severity reflects impact, not effort:

- **BLOCKER:** unsafe authority/security boundary, destructive data risk, broken core path,
  material regression, or false acceptance/readiness claim. Blocks validation and promotion.
- **IMPORTANT:** evidenced defect or maintainability risk that should be resolved before
  promotion unless an explicit owner accepts and records the bounded risk.
- **NIT:** polish, clarity, or optional improvement. Never blocks validation or promotion.

Speculation and questions are not findings and never block. Label them explicitly and promote
them to `BLOCKER` or `IMPORTANT` only after evidence establishes an actionable defect.

Small low-risk work may use deterministic acceptance evidence with no separate reviewer.
Substantive ordinary work gets focused review. Authority, security, irreversible, or broad-impact
changes require independent exact-head review. Any code change after review invalidates the
verdict; review the new exact head again.
