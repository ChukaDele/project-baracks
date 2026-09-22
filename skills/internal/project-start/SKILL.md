---
name: project-start
description: Prepare a new repository quickly by resolving the Foundry project shape, asking only material questions, inspecting related assets, selecting the first vertical slice and establishing concise project truth.
---

# Project Start

1. Confirm the canonical project/repository before creating anything. If a same/similar project may already exist locally or on GitHub, load `project-context-integrity` and `workspace-lifecycle-management` first; do not create a duplicate clone/folder because an expected path is missing.
2. Inspect the user's brief, existing code/history/assets/CI/docs, related repositories, connected sources and explicit references before asking questions.
3. Create a provisional Foundry manifest from what is already known. Do not ask for facts that can be safely inferred from the active context or named sources.
4. Resolve it with `major foundry plan <manifest>`.
5. Ask only the resolver's first question batch, maximum four questions. Questions must be material to architecture, risk, deliverables, jurisdiction or quality. Re-run after answers. Typical targets: simple artifact 0–3 questions, normal product 2–5, sensitive/regulated product 4–8 across progressive rounds.
6. Once no critical/high questions remain, state any reversible assumptions instead of extending the questionnaire.
7. Clarify the desired user/business outcome if it remains unresolved.
8. Identify the biggest uncertainty and fastest credible proof.
9. Run competitive/product-pattern, prior-art and open-source leverage audits where relevant.
10. Reduce broad requirements to P0 MVP / P1 next / P2 later.
11. Select the smallest useful end-to-end slice and simple replaceable boundaries.
12. For a genuinely new project, bootstrap with the resolved Foundry manifest. The bootstrap derives the canonical Major install profile/features from the resolver and refuses unresolved critical/high questions; do not manually choose a weaker profile.
13. Installed does not mean loaded: after bootstrap, task-level Major skill routing still selects only the smallest relevant skill set.
14. For a genuinely new local repo, prefer the current canonical active-code workspace rather than an iCloud-synced Documents folder when practical; do not move an existing healthy repo solely to satisfy a folder convention.
15. Begin the first proof/vertical slice immediately; do not start infrastructure-first or speculative documentation.

## Foundry rules

- Base archetype, capability packs, jurisdiction/risk overlays, deliverables and style are independent composition layers.
- SaaS, fintech, marketplace, ecommerce and AI app are compositions, not automatically new archetypes.
- Deck/document/spreadsheet types are deliverables, not base project archetypes.
- Explicit user references and current project truth outrank style presets.
- A project may strengthen an inherited baseline. It may not silently disable an archetype baseline.
- Legal/privacy outputs are generated from actual product/data facts and remain subject to appropriate jurisdiction-specific review; never present generic boilerplate as automatically sufficient.
