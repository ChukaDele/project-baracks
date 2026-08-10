---
name: design-direction-and-taste
description: Use before substantial UI/website creation, redesign, art-direction changes, or when the user says the design feels generic, bland, AI-looking, too safe, too loud, or lacks taste. Own the design read, surface mode, preserve-vs-redesign decision, visual grammar and calibrated variance/motion/density. Do not own browser QA or motion implementation; hand those to website-design-qa and responsive-motion-systems.
---

# Design Direction & Taste

This is Major's canonical art-direction layer. It distills useful non-duplicative ideas from Impeccable and Taste Skill while remaining subordinate to the user's brief, project truth and existing design system.

## 0. Boundary

This skill owns **what the design should become**.

It does not replace:
- `competitive-product-audit` for reference/competitor study;
- `frontend-design` / shadcn / project components for implementation technique;
- Emil skills for motion craft;
- `website-design-qa` for browser/responsive/launch QA;
- `responsive-motion-systems` for GSAP/ScrollTrigger/sticky/pinned/Three.js engineering;
- `nontechnical-ux` for operator workflow clarity.

Do not load multiple generic taste systems and let them vote. This skill is the single Major synthesis layer.

## 1. Read the room before designing

Before code or visual changes, infer the design from evidence:

1. surface/page kind;
2. audience and use scene;
3. explicit vibe words and desired craft bar;
4. references/screenshots/products the user supplied;
5. current brand assets, type, palette, imagery and design system;
6. product truth, content and functional constraints;
7. quiet constraints such as accessibility, regulation, trust, low-tech operators or performance;
8. what the user explicitly dislikes or has already rejected.

Write one concise internal **Design Read** before implementation:

`<surface mode> for <audience/use scene>; <visual language>; <primary product/design objective>; <what must not become generic>.`

Do not ask a question if the evidence already determines the direction. Ask one concise question only when two materially different directions remain plausible.

## 2. Classify the surface, not the whole product

Choose the mode from the surface's job:

- **PERSUADE** — visitor must understand, believe and act. Marketing, landing, pricing, campaign.
- **OPERATE** — user must complete tasks quickly and correctly. Product UI, dashboard, CRM, settings, admin.
- **READ** — user must understand and navigate information. Docs, articles, research, help.
- **EXPERIENCE** — the work/brand itself is the experience. Portfolio, gallery, showcase, immersive editorial.

A product can contain several modes. A SaaS marketing homepage is PERSUADE while its admin panel is OPERATE.

Mode sets priority:
- PERSUADE: offer clarity, proof, hierarchy, conversion path, memorable expression.
- OPERATE: scanability, state, task completion, familiar affordances, density discipline.
- READ: structure, measure, wayfinding, comprehension, reading rhythm.
- EXPERIENCE: artifact-first composition, exploration, signature interaction and atmosphere.

## 3. Decide preserve vs extend vs redesign vs new world

Do not accidentally polish a discarded direction or redesign a surface the user only asked to refine.

- **REFINE** — preserve identity, behavior, copy and scope; improve craft.
- **EXTEND** — inherit the established visual world; solve only the new surface/component/state.
- **REDESIGN** — preserve product truth, content, function, constraints and confirmed brand commitments; replace the old visual world deliberately.
- **NEW WORLD** — no adequate visual authority exists; create a coherent new design system from the brief and evidence.

A missing `DESIGN.md` does not mean greenfield. Existing code/tokens/assets may already be the visual authority.

## 4. Calibrate three dials

Use three relative dials to keep design decisions coherent. They are **not fixed global defaults** and must be inferred from the brief.

- **VARIANCE** — conventional/symmetric → asymmetric/experimental.
- **MOTION** — quiet/stateful → cinematic/scroll-led/physics-rich.
- **DENSITY** — gallery-like/airy → information-dense/operational.

Record them qualitatively or 1–10 when useful.

Examples:
- enterprise OPERATE surface: lower variance, low/moderate motion, moderate/high density;
- Awwwards PERSUADE/EXPERIENCE: high variance, high motion, low/moderate density;
- editorial READ: moderate variance, low/moderate motion, low/moderate density.

The user's brief wins over any preset.

## 5. Anti-default discipline

Before committing a direction, challenge category-interchangeable AI defaults:

- centered hero + generic gradient + equal three-card feature row;
- cards used merely because content needs a container;
- nested cards without hierarchy need;
- identical fade-up animation on every section;
- generic glass/blur/noise/mesh with no relationship to the subject;
- icon tile + heading + paragraph repeated as page architecture;
- default font choice made from habit instead of brand/use scene;
- arbitrary tech motifs, terminal/mono styling or neon used as costume;
- filler copy, invented claims or synthetic metrics presented as real;
- a random dark section/light section switch with no narrative reason;
- generic SaaS dashboard/sidebar conventions when the task suggests a better pattern.

These are **bias checks, not bans**. The brief may legitimately choose any pattern. The failure is reaching for it automatically.

Do not import Taste Skill's blanket rules such as “serif is bad,” “Lucide is bad,” “one accent only,” or fixed dial values. Context and the existing product system outrank those opinions.

## 6. Build one coherent visual grammar

Before broad implementation, define the smallest durable grammar needed for consistency:

- type roles and hierarchy;
- color/surface logic;
- spacing/rhythm;
- grid/container behavior;
- shape/radius/border/elevation logic;
- icon/illustration/image language;
- motion grammar;
- interaction/state language;
- density and responsive recomposition rules.

One world owns the surface. Do not combine multiple aesthetics into a mood-board collage.

Prefer a real established design system when the brief explicitly belongs to one ecosystem or the project already uses one. Do not mix competing component systems casually.

## 7. Distinctiveness must come from product truth

For substantial redesign/new-world work:

1. name the product's unique mechanism or value in one sentence;
2. identify the audience's real visual/cultural world;
3. identify the category's obvious default layout/aesthetic;
4. deliberately explore beyond that default;
5. choose one direction that improves both product clarity and audience identification.

Do not add “creative” motifs that cannot be explained by the product, audience, content or chosen world.

When the user supplies strong references, study what makes them work—composition, type, pacing, motion, density, hierarchy, material treatment—rather than cloning surface decoration.

## 8. Direction before polish

Prototype the highest-risk/signature design decision first when it materially affects the experience. Examples:
- hero transition;
- card-stack narrative;
- unconventional navigation;
- comparison interaction;
- dense operator table hierarchy;
- editorial reading system.

Once the direction is proven, complete the surface coherently. Do not endlessly explore variants after the user/design evidence has already chosen a direction.

## 9. Critique without anchoring

For a consequential design review, separate two evidence streams before synthesis:

### A. Unanchored design assessment
Evaluate before seeing deterministic detector output:
- design specificity;
- hierarchy and information architecture;
- emotional/brand fit;
- cognitive load;
- clarity of primary action/task;
- typography and composition;
- states and edge cases;
- accessibility implications;
- whether the surface feels authored for this product or category-interchangeable.

### B. Deterministic/browser evidence
Independently inspect:
- actual browser rendering;
- console/network/runtime errors;
- responsive geometry;
- interaction states;
- accessibility/performance signals;
- automated detector/lint findings when an approved detector is available.

Then synthesize agreements, misses and false positives. Do not let automated detector output anchor the design judgment before Assessment A.

Use separate reviewers when consequence justifies it; do not require a swarm for every small polish task.

## 10. Bounded finish passes

Do not polish forever.

For a normal meaningful UI finish:
1. build the intended surface fully enough to judge;
2. inspect desktop + mobile/other required classes in one batched pass;
3. fix the findings as one coherent batch;
4. confirm with at most one normal follow-up pass unless a material defect remains.

High-risk motion/production incidents may require additional root-cause rounds under `website-design-qa` / `responsive-motion-systems`.

## 11. Handoff to implementation and QA

After design direction is settled:

- implementation uses the project design system, shadcn or appropriate official component system;
- motion craft uses Emil and/or `responsive-motion-systems`;
- meaningful website work must load `website-design-qa`;
- remote browser/acceptance follows `remote-first-web-development` unless the owner has explicitly granted a local exception;
- browser evidence decides whether the implemented result actually matches the design intent.

## 12. Failure conditions

This skill has failed when:

- the result could belong to an unrelated product with only the logo changed;
- the agent imposes its own preferred aesthetic over an explicit brief;
- redesign becomes mild polish on a visual world the user asked to replace;
- refinement unexpectedly rewrites product identity/content;
- multiple taste skills give contradictory defaults and the agent mixes them;
- an Awwwards brief becomes random motion/3D rather than a coherent experience;
- an OPERATE surface sacrifices usability for visual novelty;
- the system keeps polishing after the important design decisions are already resolved.

## Resolver examples

### Should trigger

- "Redesign this landing page; it still looks like generic AI SaaS."
- "Make this feel Awwwards-level but still convert."
- "I like parts of the current dashboard but the hierarchy and overall design language are inconsistent."
- "Give this personal site a stronger visual identity based on these references."
- "The design is too safe; push it without losing the product's clarity."

### Should not trigger

- "Fix the missing import in this component."
- "Run responsive QA on the already-approved design." 
- "Debug this ScrollTrigger overlap without changing the art direction."
- "Fix a backend API error."

### Conflicts

- Direction/taste → this skill.
- Full site/browser/launch QA → `website-design-qa`.
- Motion geometry/lifecycle → `responsive-motion-systems`.
- Pure motion polish → Emil skills.
- Product workflow usability → `nontechnical-ux`.
- General bug diagnosis → `root-cause-qa`.
