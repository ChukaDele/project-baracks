---
name: lean-quality
description: Use for test strategy, release confidence and verification planning. Maximize confidence per minute with risk-proportional tests instead of exhaustive ceremony.
---

# Lean Quality

1. Identify the failure that would actually matter.
2. Test the critical E2E/value path first.
3. Add deterministic rule/contract tests where they cheaply protect high-risk logic or replaceable boundaries.
4. Deep-test permissions, private data, money, destructive writes, core decision logic, migrations and repeatable background jobs when present.
5. Use targeted tests for ordinary adapters/forms/recovery.
6. Use light checks for trivial wrappers/static copy/low-risk decoration.
7. For meaningful UI, inspect the rendered browser/preview; DOM/unit tests are not visual proof.
8. Add a regression test after a bug only when recurrence is likely or costly.
9. Do not duplicate the same proof at every layer.
10. Stop when the current outcome has enough objective evidence to proceed; do not maximize test count.
