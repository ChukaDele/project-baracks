# Mandatory independent adversarial pass

Use a separate reviewer/agent when available; otherwise run a fresh review without relying on the author's success claims. The reviewer must try to falsify completeness.

## Source completeness

1. List three likely missing behaviours from the app category and test them.
2. Pick one icon-only button, submenu, hover-only action, drag interaction, keyboard shortcut, offline/error transition, auth/plan gate and post-success result where applicable.
3. Compare source and target in both directions. Flag missing original controls and newly invented target controls. Deliberate improvements stay in the improvement lane, not the parity score.
4. Inspect empty, full, overflow, filtered, archived, denied, loading and error states; test refresh, a second tab, a second account.
5. Ensure authenticated/paid functionality is `blocked` or `documented` unless safely observed; never turn assumptions into `observed`.

## Data and backend

6. Trace each visible action to API/data, authorization, destination, persistence and integration failure cases. A clickable UI with no true destination fails.
7. Compare in-scope expected vs actual record counts, hierarchy depth, IDs/relations, attachments, exports, updates, pagination and stale content. For unbounded feeds, validate the documented ingestion/refresh contract and recency sample.
8. Use separate test users to look for cross-tenant leaks; check field-level permissions, idempotency, race conditions, rollback and deletion semantics.
9. Scrutinize unauthorized copying of content, code, trademarks and private data; verify raw captures are ignored by Git.

## Quality and claims

10. Check stale screenshots, viewport mismatch, misleading visual scores, inaccessible controls, console errors, broken deep links, SEO/performance only where in scope.
11. Inspect the CSV gate for omitted rows, fabricated source evidence, false PASS values, hidden blocked work, narrowed scope after implementation and inconsistent severity.
12. Require a proof bundle: tests executed with exit codes, screenshots with source dates, redacted test results, diff report and unresolved P0/P1/P2 issues. An agent-authored CSV alone is insufficient proof.

## Verdict

`PASS` only if scoped must-haves are observed or documented as appropriate, fully implemented, tested, supported by actual evidence and no release-blocking risks remain. `CONDITIONAL` identifies specific gaps, owners and verification steps. `FAIL` means core flow/security/data parity is materially unsupported. Do not summarize conditional as complete.
