# Deliverables, verification and gates

## Reconstructed evidence (before coding)

- `reference/project.json`: title, source mode, target phase, scope, permitted platforms and refresh budget.
- `reference/evidence.csv`: stable evidence IDs, classification, source URI/file, timestamp, state and confidentiality. Public project copies must be redacted.
- `reference/screens.csv` and `reference/flows.csv`: role/state/viewport coverage, route map and user journeys with test links.
- `reference/controls.csv`: stable screen/control IDs, source state, target state, persistence/backend/data dependencies and evidence IDs.
- `reference/features.csv`: functional requirements with must/should/could and source/target evidence IDs.
- `reference/tests.csv` and `reference/visual_checks.csv`: executed tests and comparable visual captures by viewport/state.
- `reference/findings.csv`: independent severity-ranked findings and closure status.
- `reference/data.csv`: required datasets/asset collections, rights, count reconciliation, status and evidence IDs.
- `reference/recon.md`: navigation map, user journeys, state machines, permission differences, region relationships and unobserved states.
- `reference/gaps.md`: functional/data/design/security risks ranked by user outcome.

## Build stage

- `reference/architecture.md`: entities, migrations, API contracts, state ownership, integration dependencies.
- `reference/test-plan.md`: requirements-to-tests trace, happy/failure paths, role/isolation and persistence tests.
- `reference/improvements.md`: separate from parity, prioritised using evidence, utility, build cost and downside risk.
- Actual source code changes, migrations and committed tests, following existing repo conventions.

## Release stage

- `reference/verification.md`: commands and actual outputs, source/target capture dates, visual reports, API/data validations, test failures, security/a11y findings, rollback and ownership.
- `reference/handover.md`: setup, commands, environment variable **names only**, architecture, known gaps, support/monitoring, next developer actions.
- `coverage_gate.py --stage release` passing on a truthful manifest.

The release verifier fails when no in-scope features are listed; no required data items are listed (unless project.json sets `data_in_scope=false`); interactive targets lack observed controls; MUST items are absent/partial/inferred/blocked; required datasets are incomplete/unlicensed or counts disagree; evidence references are missing; target observations have no evidence; or open critical/high severity findings exist. Cosmetic issues can be residual with documented acceptance.

**Never claim**: "pixel-perfect" based on a prompt, "100% parity" from the number of screenshots alone, "complete data" based on a sample, "tested end-to-end" based only on build/typecheck, or "installed" based on creating a ZIP in a separate runtime.

**Decision rule**: For a true user-owned replatform/migration, strive for contract and content fidelity. For a competing product, implement the lawful general functional patterns and make its brand, copyrighted content, proprietary internals and product identity independent. If the reference changes over time, pin captures and plan a refresh before launch.
