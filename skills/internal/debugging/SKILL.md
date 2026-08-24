---
name: debugging
description: Use when applying the staged debugging procedure. Apply the narrow debugging procedure and return evidence, exceptions and a bounded recommendation.
---

# debugging

## Mission

Apply the narrow debugging procedure and return evidence, exceptions and a bounded recommendation.

## Routing contract

- Positive: Apply the narrow debugging procedure and return evidence, exceptions and a bounded recommendation.
- Negative: Do not trigger for a neighbouring capability merely sharing words with debugging.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Modify only the isolated task workspace when authorised; no deploy, merge, activation, credential change or external mutation.

## Evaluation cases

- Positive case must select `engineering/debugging` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
