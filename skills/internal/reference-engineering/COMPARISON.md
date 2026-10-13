# Replica Skill research and gap analysis

Reviewed: 13 October 2026. Public GitHub documentation; direct local execution of upstream projects **not** performed. Local Mac skill inventory **not** freshly verified because connected desktop was offline. Prior skill status comes from earlier setup discussions.

## Upstream projects inspected

| Project | Scope and strongest value | Limitations / risks | Import recommendation |
| --- | --- | --- | --- |
| [Jake Schincariol: replica-skill](https://github.com/Jakeschincariol/replica-skill) | 11-stage app reconstruction from recon, architecture, design, build, backend, tests and layout/feature diff to customer feedback, branding, launch and deploy. Includes pure-Python scripts, parity score, clean-room boundaries and quality gates | Recon relies heavily on secondary sources; instructions do not ensure every original control was exercised. Feature completion can be declared by updating CSV without independent tests unless adapted. Marketing stages are often needless for internal/site reconstruction | **Adapt** recon map, feature parity, source-linked review themes, privacy/branding sweeps, release gates. Do not bulk install all 11 |
| [Surya17155: Replica](https://github.com/Surya17155/Replica) | Detailed screenshot-to-developer-prompt specification for colors, spacing, Tailwind/CSS, motion, assets and components | Text instructions alone cannot determine exact source CSS/fonts/animation from one static screenshot; no inherent rendered verification, backend or data parity | **Optional** specification template only, especially where visual design is being translated into code |
| [leosssvip-dot: website-replication-skill](https://github.com/leosssvip-dot/website-replication-skill) | Evidence-first browser enumeration, control intent ledger, region state relationships, permission/persistence ownership, full-depth content inventory, reverse audit, readiness/coverage checks, safeguards for consequential actions and private evidence | High effort for trivial pages; requires supported browser automation for actual interaction coverage. Network traces are sensitive and must be redacted and authorized. 30-day default caching may be stale for fast-moving products | **Primary methodology** for web app behavioural reconstruction and full-fidelity audits |
| [Agent Skills standard](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx) | Portable `SKILL.md` frontmatter, progressive disclosure, optional scripts/references | Agent runners vary in discovery paths, link behaviour and supported tools | Use one router with small references and offline validation rather than many always-loaded prompts |

## Existing setup comparison (historical, not live audited)

| Existing component | Owns | Enhancement added by this router |
| --- | --- | --- |
| Reference Replica | Screenshot/mockup visual recreation | Source/target visual ledger, incomplete-source labels and explicit asset inventory |
| Engineering by Reference | Product behaviour or engineering reconstruction | Browser control/region contracts and data/feature traceability |
| REA v3.2.1 | Authorized system investigation, code/artifact analysis | Rights classification, ownership-safe usage and strict provenance; do not treat arbitrary competitor binaries as authorized |
| Figma Fidelity | Source-to-render measurement/repair loop | Connect visual metrics to workflow and data release gates |
| UI Skills (`create-design-md`, `interface-design`, `react-doctor`, `improve-ui`, `web-quality-audit`) | Style, component quality, diagnostics and web audits | Trigger only when relevant; avoid duplicating a skill's job |
| Emil `mobile-native`, `break-ui` | Mobile-specific and stress-case quality | Route only when mobile requested/in scope, always capture error/overflow states for relevant screens |
| Playwright/browser QA | Automated interactions and visual/browser evidence | Stable IDs, requirement-to-test mapping, independent opposite-direction audit |

## Most consequential missing capabilities, ranked by risk and leverage

1. **Truthful completeness and evidence**: an observed screen is not observed behaviour. Stable control IDs, state inventories, source age, `observed`/`documented`/`inferred`/`blocked` tagging and gap reports stop plausible invention.
2. **Full data depth and persistence**: counts, relationships, hierarchy, version/archive histories, licensed sources, integration refresh logic, destination state and RLS are first-class requirements. A sample dataset can never masquerade as the full product.
3. **Two-way parity**: inspect both missing original controls and invented target controls; verify every click's state, persistence, data and server result. Visual diff alone is insufficient.
4. **Independent test and release gate**: link must-have functionality to real test evidence, run red-team tests and reject stale, blocked or incomplete items. Metadata score is not itself test evidence.
5. **Differentiated improvement lane**: real user-feedback signals and clear commercial/user outcomes justify additions, while protecting the baseline from uncontrolled feature creep.
6. **Routing and IP/security governance**: leverage installed Figma/REA/QA specialists; choose rights-aware inspection and minimal skill loading; avoid bulk installation, private evidence leaks and accidental production changes.

## Recommended architecture and decision

**Default strategy:** one `reference-engineering` orchestration skill as the single entry point. Keep specialist skills independent; adopt Website Replication's evidence ledger, Jake's feature/test/parity/entrepreneur methods, and Surya's visual prompt sections only when the input is a screenshot or mockup. Use the user-owned codebase as the truth wherever available.

**Default priority order:** make the core user outcome work end to end, then verify its data contracts and role/access semantics, then complete hidden states and secondary journeys, then measure visual fidelity, then add evidence-based improvements. Visual fidelity may be prioritized earlier where the request is explicitly design-only.

**When not to use a full replication workflow:** for a one-off screenshot-based hero design, invoke Reference Replica and a visual QA pass directly. For a user-owned system with source and database access, inspect those first; do not waste time inferring behaviour from screenshots.

## Adoption and verification plan

1. On Mac reconnect, inspect actual skills under `~/.agents/skills`, `~/.claude/skills` and project-local directories. Check that REA, Reference Replica, Engineering by Reference, Figma Fidelity and UI Skills resolve; identify duplicate names and stale versions.
2. Use the installer only for the new router. Keep specialist skill IDs and precedence unchanged, and run current skills routing tests. Do not modify another skill without a diff/review.
3. Prove three fixtures: static screenshot; authorized web-app interaction with hidden state/data; user-owned app migration with full export and archives. Test both successful and intentionally missing/blocked features.
4. Confirm browser capture and actual E2E workflow are available on the machine. Inspect one result visually and run adversarial review. Confirm gbrain successfully indexed the skill separately.
5. Version-pin upstream inspirations if later integrating executable scripts. Scan all third-party code before installing. Roll back by restoring the timestamped backup or removing this router, leaving existing specialists untouched.

## Audit caution

A complete-looking UI is not product parity. A 100% CSV coverage figure is worthless if an agent omitted controls from the inventory, guessed source behaviour or claimed tests that never ran. Independent source enumeration, real browser testing and real data reconciliation remain mandatory.
