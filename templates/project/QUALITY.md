# Lean quality

Goal: **confidence per minute**, not maximum checks.

## Evidence stages

- **FAST:** focused checks while editing. Use these to shorten feedback loops.
- **ACCEPTANCE:** objective proof of the P0 critical path and any meaningful recovery path.
- **RELEASE:** one frozen-candidate gate when a release decision needs it. Do not repeat it after unrelated status changes.

Choose independent review and deeper checks in proportion to consequence, uncertainty and changed risk boundaries.

## Current outcome risk

[Low / medium / high + why]

## Minimum evidence

- critical user/operational path
- one meaningful failure/recovery path when relevant
- deterministic/contract tests for high-risk rules or replaceable boundaries
- rendered browser review for meaningful UI
- permission/persistence/provider evidence only where the current slice uses those boundaries

## Deep-test when present

- private/sensitive data and permissions
- money or destructive production writes
- core scoring/decision logic
- migrations
- repeatable background jobs that can duplicate work
- critical integrations

## Avoid

- exhaustive snapshots
- duplicate tests at every layer
- implementation-detail tests
- repeatedly rerunning flaky checks without diagnosis
- large E2E suites before the first useful slice
