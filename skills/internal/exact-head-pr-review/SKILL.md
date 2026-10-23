---
name: exact-head-pr-review
description: Review a pull request against the exact current head SHA and determine truthful readiness.
---

# Exact-Head PR Review

Record exact head SHA; inspect scope/diff/affected callers; run relevant tests rather than everything; inspect rendered UI for UI changes; check persistence/migrations/permissions/cost/failure states where relevant; verify status/evidence; if head changes materially, review again; return approve/changes/blocked with evidence.

## Merged aliases

Also answers to the retired `review` skill id (merged 2026-10-23). Assess the implementation against its acceptance criteria and list actionable defects. An independent verdict must come from a reviewer that did not produce the candidate.
