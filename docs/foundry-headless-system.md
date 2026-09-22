# Foundry headless project system

Status: v1 consolidation draft. The model is deliberately data-driven: Major stays the thin control plane; Foundry manifests and packs describe project composition.

## Goal

A user should describe a project in normal language. The agent should infer safe defaults from that brief, existing repositories, connected sources and references, then ask only questions whose answers materially change architecture, risk, deliverables or quality.

The output is a small project manifest. Deterministic code resolves that manifest into:
- global operating rules;
- a base archetype;
- capability packs;
- jurisdiction/risk overlays;
- deliverables;
- a style profile;
- quality/release evidence.

Natural-language interpretation is model work. Inheritance, protected baselines and pack expansion are deterministic.

## Composition layers

1. **Kernel** — cross-project operating rules: project identity, source priority, reuse-first, minimal implementation, evidence, exact-head release review and secret safety.
2. **Archetype** — the primary thing being built.
3. **Business/domain context** — SaaS, internal, recruitment, finance, public sector, media, etc.
4. **Capability packs** — identity, privacy, legal, commercial, communications, analytics, operations, public web, security, data, integrations, AI, commerce.
5. **Risk/jurisdiction overlays** — personal data, payments, regulated work, geography.
6. **Deliverables** — user-requested outputs such as app/site/service, deck, document or spreadsheet.
7. **Artifacts** — Foundry-required supporting outputs such as release evidence, privacy notices, threat models or runbooks.
8. **Style** — an orthogonal design/voice preset, overridable by explicit references.
9. **Quality profile** — inherited gates plus stronger project-specific requirements.

Projects may add or strengthen requirements. They may not remove an archetype baseline without changing archetype or explicitly changing the Foundry catalog in a reviewed global change.

## Base archetypes

- `webapp`
- `marketing-site`
- `experience-site`
- `mobile-native`
- `backend-service`
- `automation-agent`
- `data-product`
- `library-cli-sdk`
- `content-media`
- `knowledge-work`

SaaS, fintech, marketplace, ecommerce and AI app are compositions, not separate base archetypes.

## Adaptive intake

Do not present a static questionnaire.

### Phase 0 — infer

Before asking anything:
- inspect the user's brief;
- inspect an existing repo/project when named;
- reuse prior project facts already in the active context;
- infer obvious deliverables and style defaults;
- identify uncertainty that is material rather than merely incomplete.

### Phase 1 — ask only material questions

Critical decisions:
- concrete outcome;
- base archetype when ambiguous;
- jurisdiction when regulated, payments or personal data make it relevant.

High-value decisions:
- primary audience;
- data sensitivity;
- access model when it changes identity/security;
- AI autonomy when it changes approvals/evals.

Medium decisions:
- commercial model where billing/terms could be required;
- style only when references/brand do not make direction obvious;
- deployment only when platform choice changes the architecture.

Ask at most four questions in one batch. Resolve again after the answers.

### Question budgets

- Simple public site or one-off artifact: normally 0–3 questions.
- Typical product: normally 2–5 questions.
- Sensitive/regulated product: normally 4–8 questions across progressive rounds.
- Never ask for a fact that can be safely derived from a named repo, connected source or explicit reference.

Unasked non-material details receive a stated default assumption. Defaults stay reversible.

## Capability packs

Packs represent reusable product/operating concerns rather than vendors.

Examples:
- `identity` does not mean WorkOS; it means sessions, account lifecycle, organisations, permissions and recovery. A project/provider decision chooses WorkOS, Supabase, Better Auth or another implementation later.
- `commercial` does not mean Stripe; it means plans, billing, entitlements, invoicing, cancellation, tax and dunning.
- `privacy` means operational privacy capability: data map, retention, export, rectification, deletion, rights handling and breach response — not only a privacy-policy route.

Pack contents live in `guidance/foundry/catalog.json`.

Each pack separates:

- **baseline modules** — minimum requirements once the pack is activated;
- **available modules** — reusable extensions Foundry knows how to add but does not force;
- **baseline artifacts** — supporting outputs the activated pack genuinely requires;
- **available artifacts** — templates/runbooks that remain dormant until project facts make them necessary.

This distinction is binding. "Templatable" does not mean "installed or generated everywhere." For example, simple authentication does not automatically require SSO, MFA or passkeys; those stay available until the brief requires them.

The resolved plan also maps the archetype back into Major's existing project-install vocabulary (`core`, `knowledge`, `web-ui`, `exploratory`, `full` plus features such as `security` or `vercel`). Foundry does not create a second skill installer.

## Legal and privacy generation

Legal artifacts must be generated from structured product facts. Do not copy a universal Terms or Privacy Policy.

The manifest and later legal/data submanifest should record:
- controller/entity;
- users/data subjects;
- data categories;
- purposes and legal basis where applicable;
- processors/subprocessors;
- retention;
- international transfers;
- rights workflows;
- automated decision-making;
- commercial model;
- governing jurisdiction.

Foundry may create structured drafts and completeness checks. High-risk or regulated launches still require appropriate qualified review. Legal review is a gate, not a claim that a template is automatically legally sufficient.

## Deliverables

Deck, document and spreadsheet types are deliverables, not base project archetypes.

Examples:
- `deck.investor-pitch`
- `deck.proposal`
- `deck.sponsorship`
- `deck.board`
- `document.prd`
- `document.bid`
- `document.report`
- `sheet.financial-model`
- `sheet.reconciliation`
- `sheet.scenario-analysis`

One project can produce many deliverables. Pack-generated policies, runbooks and evidence are **artifacts**, not hidden extra deliverables.

If the user asks for only `deck`, `document` or `sheet`, Foundry asks what decision/outcome the artifact should cause and then selects a typed profile. If the brief already makes the type clear, it asks nothing.

## Style

Style is independent of deliverable purpose.

Initial presets:
- `minimal-system`
- `consulting-executive`
- `editorial-premium`
- `cinematic-experience`
- `luxury-restraint`
- `institutional-trust`
- `technical-mono`
- `bold-startup`
- `data-dense`

The explicit brief and supplied references always outrank the preset.

## Maturity

A pack/template moves through:
1. **candidate** — sourced but not proven in our projects;
2. **project-proven** — survived representative real work;
3. **foundry-approved** — reusable, evaluated and protected globally.

Do not promote attractive external patterns directly to mandatory global policy.
