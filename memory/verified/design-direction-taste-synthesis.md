# Verified design-direction synthesis — Impeccable + Taste Skill

## Sources and scope

Reviewed 2026-08-10 as upstream design-capability sources for Major.

- `pbakaus/impeccable` at commit `2ab054d1f400c5ec085133352232ffc2617f0d54` — Apache-2.0.
- `Leonxlnx/taste-skill` at commit `e988add20dab0fa97d7a76781c48961c8184288e` — MIT. Its default `design-taste-frontend` v2 is explicitly marked experimental upstream.

These sources are **not installed wholesale** into Major. Major already has frontend-design, the full Emil bundle, craft-web-interfaces, verify-in-browser, responsive-motion-systems, exploratory-creative-dev, nontechnical-ux and research-product-patterns. Loading all three taste systems concurrently would create contradictory defaults and context bloat.

Major originally distilled the non-duplicative judgment into `design-direction-and-taste`. Its current successor is the canonical `craft-web-interfaces` skill.

## What Major adopted

### From Impeccable

1. **Surface mode beats product category.** Distinguish PERSUADE, OPERATE, READ and EXPERIENCE at the surface level.
2. **Refinement and redesign are different operations.** Refinement preserves the incumbent world; redesign preserves product truth/function/constraints while deliberately replacing the visual world.
3. **Existing code can be visual authority.** A missing DESIGN.md does not mean greenfield.
4. **Design specificity is a first-class quality signal.** Ask whether the design could be transplanted to an unrelated product with only the logo changed.
5. **Separate unanchored design judgment from deterministic/browser evidence** before synthesis, so detector output does not anchor the design review.
6. **Bound finish passes.** Build enough to judge, inspect in a batched device pass, fix coherently, confirm once unless a material defect remains.
7. **States and browser surfaces are part of craft.** Empty/loading/error/focus/selection/caret/scrollbar/real copy should not be forgotten.
8. **Product truth beats aesthetic habit.** A pinned brief and confirmed brand commitments override generic taste rules.
9. **Deterministic design detectors can complement human/model review.** This is retained as a possible subordinate tool, not installed globally yet because Impeccable's live/local-server hook conflicts with Major's remote-first preview policy. Source-file detector use can be evaluated separately.

## From Taste Skill

1. **Read the room first.** Infer page kind, audience, references, brand assets and quiet constraints before writing UI.
2. **Explicit Design Read.** State the inferred design direction concisely before implementation when the direction is material.
3. **Variance / motion / density are useful design-control axes.** Treat them as relative calibration dials inferred from the brief, not universal numeric defaults.
4. **Anti-default discipline.** Actively challenge generic AI patterns such as centered-gradient heroes, equal feature cards, generic glassmorphism, repetitive fade-ups and decorative tech motifs.
5. **Audit-first redesign.** Understand the current stack and design before changing it.
6. **Dependency/import reality.** Never assume a design library exists; inspect the actual project dependency/design-system state.

## Explicitly rejected or demoted

Major does **not** adopt these as global rules:

- blanket serif discouragement;
- blanket Lucide discouragement;
- one-accent-color limits;
- fixed default values for variance/motion/density;
- universal max-width/font/stack prescriptions;
- fixed font pools or rotating fonts as policy;
- absolute bans on common patterns when the user's brief genuinely calls for them;
- Taste Skill's landing/portfolio-only scope as a universal UI rule;
- Impeccable's full command layer, local live server, global hooks or parallel critique ceremony as mandatory behavior.

Reason: these are taste opinions or implementation choices that can conflict with project truth, user intent, established systems, Major's remote-first workflow or existing specialist skills.

## Canonical separation after synthesis

- **Art direction / visual approval / design contract:** `craft-web-interfaces`
- **Reference and product-pattern learning:** `research-product-patterns`
- **Implementation technique:** project design system, shadcn, `frontend-design`
- **Motion craft:** Emil skills
- **Complex responsive motion engineering:** `responsive-motion-systems`
- **Browser/responsive/production/launch QA:** `verify-in-browser`
- **Operator workflow clarity:** `nontechnical-ux`
- **Experimental Awwwards/FWA implementation:** `exploratory-creative-dev`, after design direction is settled

One design-direction authority prevents duplicate taste systems from fighting each other.

## Reuse condition

When a future design skill/tool is proposed, compare it against this separation. Adopt only a genuinely new capability or stronger evidence method; otherwise distill useful ideas into the canonical layer and reject duplicate command/taste systems.
