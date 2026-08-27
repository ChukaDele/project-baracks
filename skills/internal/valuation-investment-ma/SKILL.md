---
name: valuation-investment-ma
description: Use when applying the staged valuation investment ma procedure. Prepare evidence-linked valuation and transaction analysis without investment or binding authority.
---

# valuation-investment-ma

## Mission

Prepare evidence-linked valuation and transaction analysis without investment or binding authority.

## Routing contract

- Positive: Prepare evidence-linked valuation and transaction analysis without investment or binding authority.
- Negative: Do not trigger for a neighbouring capability merely sharing words with valuation investment ma.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Read, classify, calculate in deterministic local tooling, and draft only. Posting, invoices, write-offs, credit notes, collections and money movement require approval and the system of record.

## Evaluation cases

- Positive case must select `finance-accounting/valuation-investment-ma` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
