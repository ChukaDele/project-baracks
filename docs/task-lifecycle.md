# Major 2.0 task lifecycle

Major's unit of progress is a **verifiable outcome**, not a tiny implementation fragment.

## Target semantic states

```text
BACKLOG (P0/P1/P2)
   ↓
READY
   ↓
RUNNING
   ↓
VERIFYING ──fail──→ REPAIRING ──→ VERIFYING
   │
   └─pass──→ DONE

Any active state ──genuine owner-only gate──→ BLOCKED_OWNER
BLOCKED_OWNER ──resolved──→ READY/RUNNING/VERIFYING
```

The implementation may use additional internal states for leases, reviews or provider runs, but those mechanics must not turn into user-visible ceremony or force the project to stop unnecessarily.

## Backlog and priority

Broad requests are first reduced to:

- **P0 / MVP** — minimum set needed to prove the core value loop;
- **P1 / next** — material improvements after proof;
- **P2 / later** — nice-to-have, scale, optimisation or speculative scope.

Do not dispatch P1/P2 breadth while the P0 critical path is still only partially built unless the work is genuinely independent and does not slow the critical path.

## READY

The outcome and acceptance evidence are clear enough to execute. Real dependencies that block the task are satisfied or explicitly isolated behind a mock/adapter/prototype.

## RUNNING

One or more workers execute the task. Parallel branches are encouraged when they shorten the critical path. Writers use isolated worktrees and explicit ownership.

A technical failure does not automatically leave RUNNING. Diagnose and repair while useful options remain.

## VERIFYING

Check the actual acceptance condition. Verification may use browser/runtime behavior, tests, exact commit/PR state, persisted data, provider response, deploy/preview result or human review when the result is inherently subjective.

Agent self-report is not evidence.

## REPAIRING

A verification failure creates a bounded repair loop. Fix the root cause and retest. After two materially unchanged failed strategies, change strategy/tool/model or isolate the failing boundary.

## BLOCKED_OWNER

Reserve this for true human-only dependencies such as credentials/MFA/consent, new paid API/credits, destructive production data, DNS/ownership, production security exceptions or another explicit project gate.

Before entering `BLOCKED_OWNER`, preserve evidence and continue independent productive work where possible.

## DONE

The requested outcome is demonstrably true against the agreed acceptance condition.

Done does not require every deferred feature, enterprise hardening task or original backlog item. It means the active outcome/MVP milestone is complete.

## Runtime migration note

Major v1's current database/code uses a more complex status model and hard-disabled completion/worker execution. During Major 2.0 implementation, migrate persistence safely to these simpler semantics or map old internal states behind this interface. Delete obsolete v1 gates/states once the replacement execution path is proven.