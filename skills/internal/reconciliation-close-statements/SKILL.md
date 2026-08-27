---
name: reconciliation-close-statements
description: Use when applying the staged reconciliation close statements procedure. Prepare deterministic reconciliations, close checklists and statement tie-outs with explicit exceptions.
---

# reconciliation-close-statements

## Mission

Prepare deterministic reconciliations, close checklists and statement tie-outs with explicit exceptions.

## Routing contract

- Positive: Prepare deterministic reconciliations, close checklists and statement tie-outs with explicit exceptions.
- Negative: Do not trigger for a neighbouring capability merely sharing words with reconciliation close statements.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Read, classify, calculate in deterministic local tooling, and draft only. Posting, invoices, write-offs, credit notes, collections and money movement require approval and the system of record.

## Evaluation cases

- Positive case must select `finance-accounting/reconciliation-close-statements` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
