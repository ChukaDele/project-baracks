---
name: reference-engineering
description: Coordinate authorized whole-product functional reconstruction from existing websites, applications, repositories, user-owned accounts and exports when screens, roles, workflows, data and tested feature parity all matter. Do not use for a screenshot-only clone, a Figma frame, a protocol-only reverse engineering task, or a routine existing website QA. Routes specialist skills and requires evidence-backed control, data and behavior completeness.
license: MIT
compatibility: Python 3.9+ for optional offline coverage gate. Browser and filesystem tools required for verified interactive reconstruction. Works with Codex, Claude Code, and compatible agent skill runners.
metadata:
  version: "1.1.0"
  maintenance: "user-maintained integration skill"
---

# Reference Engineering: reconstruct what matters, prove what works

Use this skill as a **router and evidence contract**, not a second copy of existing specialists. For visual-only references, use Reference Replica; for Figma frames, use the official Figma implementation workflow; for behavior-only apps/binaries, Engineering by Reference/REA remains the parent. Only coordinate here when whole-product functionality, data and parity are in scope.

Major-managed web work must honour the existing remote-first-web-development and browser leasing policy. Browser and Playwright QA should target an authorized remote preview unless the owner has approved an isolated local testing exception. Never use this skill to override project or production authority. First inspect the existing stack, repository instructions, available tools and skills. Preserve the original code, data, routes and working behaviour in an owned application unless the scope explicitly authorizes changes.

## 0. Establish the authorization and desired outcome

Classify the source using [source-modes.md](references/source-modes.md): `owned`, `authorized`, `public-competitor`, or `research-only`. Establish whether the deliverable is (a) visual inspiration, (b) high-fidelity visual implementation, (c) behaviour/workflow parity, (d) an authorized full-system restoration or migration, or (e) a differentiated product. Respect IP, licenses, terms and data rights. Do not acquire credentials, defeat access controls, reproduce proprietary assets/copy without rights or execute consequential actions without specific authorization.

Scope is explicit: target screens/flows, viewport/platform, roles, user-owned data and integrations, complete or MVP, and what may be improved. When a reference is incomplete, record uncertainty rather than filling gaps with plausible behaviour.

## 1. Route instead of reinstalling or overlapping skills

Read [skill-routing.md](references/skill-routing.md) and invoke only the relevant, available specialists:

- **Screenshot/mockup**: existing `reference-replica` and `interface-design` / `create-design-md` (if available). Surya17155/Replica offers a prompt blueprint; measurement and rendering provide verification.
- **Figma**: existing Figma-native design-to-code followed by `figma-fidelity`. Use design-node metadata/tokens when authorized and accessible.
- **Live website/app**: browser automation plus a control/region audit, adapting leosssvip-dot's `website-replication-skill` methodology. REA / `engineering-by-reference` for permitted engineering reconstruction. Never infer full behaviour from a static fetch.
- **Architecture/system**: REA and repo inspection for user-owned/authorized code; API docs and explicitly authorized redacted traces for external systems. Use `replica-architect`/`replica-backend` patterns only when needed.
- **QA**: `figma-fidelity`, `break-ui`, `mobile-native` if mobile is in scope, Playwright, accessibility and app-specific contract tests. `replica-diff` concepts for feature parity.
- **Product differentiation**: `replica-entrepreneur` approach for verified user feedback; brand/launch/deploy only on request. Do not automatically add marketing workflows to a reconstruction job.

If a specialist is absent, continue with the methodology and record the capability gap. Do not claim installation or platform integration until verified.

## 2. Collect source evidence and enumerate without losing depth

Create `reference/` in the target project from [project-template](assets/project-template), or use existing equivalent files without duplication. Capture and attribute each claim with a stable evidence ID, source URI/file, captured date/time, screen/role/state, observation status (`observed`, `documented`, `inferred`, `blocked`), and confidentiality. Keep raw screenshots/traces/PII in gitignored `reference/evidence-private/` or another secured ignored directory; redact excerpts and never publish this folder.

For interactive targets, enumerate routes, controls, menus at every depth, modals, filters, scroll-triggered states, permissions, loading, empty/error/success states, keyboard/hover/context actions, persistence, and role differences. Capture *before* and *after* state for safe test actions. Never call unvisited functionality verified. For dangerous actions, stop before commit unless explicitly authorized; report `blocked`.

For each relevant control, specify trigger → expected state change → dependent data/API → persistence owner → destination/affected regions → evidence. Detect under-build (dead controls) and over-build (invented features), and distinguish desired improvements from source parity.

## 3. Census data as well as features

Inventory all **in-scope, lawfully usable** datasets and assets. Separate interface structure, records, documentation, licensed media, user-owned exports, live/changing feeds and content supplied by users. Record ownership/permissions, source, full hierarchy depth, expected/actual counts where knowable, identifiers, relations, pagination/filters, import/export, refresh strategy and historical/archive semantics. Verify counts, keys, relational integrity and samples independently. Do not invent missing data or scrape protected content. If current content cannot be licensed or accessed, implement a lawful integration or use clearly labelled fixtures and declare the gap.

A UI shell with fake data is an early prototype, not a finished replication. A button is not complete until its backend, persisted state, permissions and destination have been verified.

## 4. Build the minimum complete vertical slice first

Map evidence to acceptance criteria and an implementation plan. Reuse the target repo's framework, existing components, databases, integrations and tests. Preserve working behaviour unless a recorded requirement explicitly changes it. Prefer the core loop end-to-end, then fill remaining high-priority features. Separate `PARITY` tasks from `IMPROVEMENT` tasks. New or better behaviour should be explicitly justified by evidence, user priorities, risk and expected value. No fabricated reviews, urgency or marketing proof.

Write tests alongside implementation. For every in-scope must-have, record an actual target test or browser result and source evidence. Run the same representative flows on the source and rebuilt target, then compare **persisted state as well as visible UI**: generated IDs, timestamps, status transitions, ordering, uniqueness, relationships and archive history. Record every deliberate deviation as an approved improvement; otherwise repair the difference. Check visual fidelity where applicable (same viewport, state and content), interaction parity, record completeness/freshness, auth and tenant isolation, accessibility, errors, race conditions, and persistence across refresh/second session. Run the independent checklist in [adversarial-review.md](references/adversarial-review.md).

## 5. Require a hard coverage gate before saying "complete"

Populate `screens.csv`, `flows.csv`, `features.csv`, `controls.csv`, `data.csv`, `evidence.csv`, `tests.csv`, `visual_checks.csv`, and `findings.csv` from the template. Run:

```bash
python3 /path/to/reference-engineering/scripts/coverage_gate.py --dir ./reference --stage release
```

The script is an **offline audit of declared evidence**, not an application test or screenshot verifier. It does not independently prove claims in the CSVs. Inferred, absent, partial or blocked must-have functionality fails release. Unknown/inaccessible required datasets fail release. If no browser or no source access exists, the interactive verdict is unverified regardless of attractive screenshots. Never hide blocked work by removing rows from scope. Do not manipulate the denominator to inflate coverage.

The final summary must separate: source observations, target behaviour **actually tested**, inferred claims, blocked/unavailable capabilities, data completeness, regression tests run, security/a11y findings, improvements proposed/shipped, and residual risk. User approval is required for deployment or consequential changes.

## Required artifacts and lifecycle

See [delivery-contract.md](references/delivery-contract.md) for required outputs, stage-specific gates, handoff and statuses. The default path is:

`scope & rights -> evidence & controls -> data census -> requirements -> core vertical slice -> source-to-target tests -> reverse audit -> improvement backlog -> release gate`

Stop at the requested phase. Do not trigger paid services, publishing, branding, mobile development or deep binary tools unless appropriate and authorized. Any result described as "full" must be complete against an explicitly documented scope and independently verified, not merely look complete.
