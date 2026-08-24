---
name: software-engineering
description: Use when applying the staged software engineering procedure. Compose the smallest relevant engineering procedures without duplicating their contracts.
---

# software-engineering

## Mission

Compose the smallest relevant engineering procedures without duplicating their contracts.

## Routing contract

- Positive: Compose the smallest relevant engineering procedures without duplicating their contracts.
- Negative: A single specialist procedure is already known; route directly to that specialist.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Modify only the isolated task workspace when authorised; no deploy, merge, activation, credential change or external mutation.

## Evaluation cases

- Positive case must select `engineering/software-engineering` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
