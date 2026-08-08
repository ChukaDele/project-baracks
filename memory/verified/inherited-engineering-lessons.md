# Verified inherited engineering lessons

These are reusable cross-project lessons promoted into Major. Project-specific business rules and sensitive data are excluded.

1. A local happy path is not end-to-end completion.
2. Do not create unnecessary staging, database or infrastructure projects.
3. Canonical persisted state beats mocks and duplicated UI state once the boundary is meant to be live.
4. Permissions must ultimately be enforced below the UI where the risk requires them.
5. Variable-length processes should use child records/events rather than fixed stage columns.
6. Preserve provenance and meaningful generated, human-edited and final versions.
7. Failed, stale, incomplete and retrying states must be explicit.
8. Background work must be idempotent and observable enough to recover.
9. Scores and decision signals belong where operators make decisions.
10. Browser QA is required for meaningful UI claims; DOM tests miss visual regressions.
11. Agents should diagnose and fix safe issues autonomously, then report evidence.
12. Do not stop a whole project for one blocked dependency when useful independent work remains.
13. Reward proactive root-cause behaviour rather than one-off activity.
14. Use correct cohorts and response lags; do not compare outcomes to the wrong period.
15. Build on proven internal/open-source systems before commodity functionality.
16. Optimise workflows for the actual user, especially non-technical operators.
17. Research has value when it changes a build/buy/reuse/design decision.
18. Prefer the simplest correct implementation.
19. Keep business rules independent of frameworks, UI, databases and providers.
20. Major components should be replaceable through stable contracts without changing unrelated product areas.
21. Do not add abstractions without a current requirement or second implementation.
22. Contract tests are cheap protection for genuinely swappable providers/formulas.
23. Use graph engineering for real dependencies, branches, verifiers, anchors, human gates and stop rules.
24. Keep simple work linear; orchestration complexity must earn its place.
25. Reward verified outcomes, proactive root cause, reuse, simplicity and learning — not code volume or agent activity.
26. Reward systems need anti-gaming and evidence outside the agent's self-report.
27. Prototype the biggest uncertainty in the fastest credible medium before deep implementation.
28. A broad feature list should be reduced to an end-to-end P0 MVP before P1/P2 expansion.
29. Keep visible/demonstrable progress while infrastructure catches up when safe.
30. UI may lead backend through explicit replaceable mocks/contracts; never misrepresent mock state as live.
31. Study competitors and adjacent best-in-class products before reinventing standard product workflows.
32. Reuse maintained UI primitives such as shadcn for commodity product components; spend custom effort on differentiated workflow/value.
33. After two materially unchanged failed approaches, change strategy rather than repeat.
34. Optimise subscription/rate-limit capacity and time-to-verified-outcome, not token count in isolation.