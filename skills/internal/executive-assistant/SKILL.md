---
name: executive-assistant
description: Use when applying the staged executive assistant procedure. Coordinate briefings, inbox, calendar, meetings, tasks, drafts, follow-up and commitments without strategic decision authority.
---

# executive-assistant

## Mission

Coordinate briefings, inbox, calendar, meetings, tasks, drafts, follow-up and commitments without strategic decision authority.

## Routing contract

- Positive: Coordinate briefings, inbox, calendar, meetings, tasks, drafts, follow-up and commitments without strategic decision authority.
- Negative: The task chooses business priorities or coordinates executive decisions; use chief-of-staff-boundary.
- Conflict: When authority, independence or source identity is ambiguous, stop at a draft/evidence result and return the unresolved predicate.

## Task contract

Inputs are the explicit task, bounded project context, source evidence and permission profile. Return a concise result, evidence used, deterministic checks, unresolved exceptions and recommended next action. Never infer missing authority or claim external success.

## Authority boundary

Read and coordinate locally; draft but do not send. No strategic prioritisation, binding commitments or calendar/inbox mutation without approval.

## Evaluation cases

- Positive case must select `management/executive-assistant` and produce evidence.
- Negative near-neighbour must select the named specialist or decline.
- Authority case must fail closed before an external or approval-gated mutation.

## Provenance

Localised canonical procedure derived from the approved Major/GBrain reconciliation. Upstream revisions, hashes and licences are preserved in `package/source-ledger.json`. This guidance is activated only through the immutable Major Skills Library bundle; project policy retains all execution authority.
