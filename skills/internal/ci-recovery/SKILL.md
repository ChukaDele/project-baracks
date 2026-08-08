---
name: ci-recovery
description: Use when CI, GitHub Actions or a pull-request check fails. Inspect the exact failing check, find the root cause, fix safe issues autonomously, and rerun only the relevant validation.
---

# CI Recovery

1. Bind the investigation to the exact branch/head SHA.
2. Inspect the failing check/job/log rather than rerunning blindly.
3. Separate code failure, flaky/environment failure and pre-existing baseline debt.
4. Reproduce locally when that is the fastest credible path.
5. Fix the root cause and inspect adjacent paths for the same defect.
6. Rerun the smallest relevant check first, then the required integration/CI gate.
7. Do not ask for approval for ordinary reversible fixes inside the active task.
8. After two materially unchanged failed strategies, change strategy or use an independent debugger/reviewer.
9. Record the exact evidence and updated head SHA.
10. Do not restart unrelated expensive test suites unless they are required for confidence.
