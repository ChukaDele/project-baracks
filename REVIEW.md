# Review policy

Review the exact candidate and report findings before summaries. Severity reflects impact,
not effort:

- **P0 — critical:** unsafe authority/security boundary, destructive data risk, or core path
  cannot work. Blocks validation and delivery.
- **P1 — major:** acceptance path is wrong, material regression, or evidence/readiness claim is
  false. Blocks validation and delivery.
- **P2 — moderate:** bounded defect or maintainability risk with a safe workaround. Fix before
  promotion when practical; otherwise record an owner and follow-up.
- **P3 — minor:** polish, clarity, or non-blocking improvement. Does not block promotion.

Small low-risk work may use deterministic acceptance evidence with no separate reviewer.
Substantive ordinary work gets focused review. Authority, security, irreversible, or broad-impact
changes require independent exact-head review. Any code change after review invalidates the
verdict; review the new exact head again.
