---
name: exact-head-pr-review
description: Review a pull request against the exact current head SHA and determine truthful readiness.
---

# Exact-Head PR Review

Record exact head SHA; inspect scope/diff/affected callers; run relevant tests rather than everything; inspect rendered UI for UI changes; check persistence/migrations/permissions/cost/failure states where relevant; verify status/evidence; if head changes materially, review again; return approve/changes/blocked with evidence.