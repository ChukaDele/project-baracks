---
name: deterministic-accounting-boundary
description: Use when applying the staged deterministic accounting boundary procedure. Fail closed unless debits, credits, balances, dates and state are computed and validated deterministically.
---

# deterministic-accounting-boundary

## Mission

Fail closed unless debits, credits, balances, dates and state are computed and validated deterministically.

## Routing contract

- Positive: Fail closed unless debits, credits, balances, dates and state are computed and validated deterministically.
- Negative: Do not trigger for a neighbouring capability merely sharing words with deterministic accounting boundary.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Read, classify, calculate in deterministic local tooling, and draft only. Posting, invoices, write-offs, credit notes, collections and money movement require approval and the system of record.

## Evaluation cases

- Positive case must select `finance-accounting/deterministic-accounting-boundary` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
