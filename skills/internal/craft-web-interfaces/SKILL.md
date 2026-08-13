---
name: craft-web-interfaces
description: Establish and implement the visual direction for a substantial new interface, redesign, landing page or interaction-heavy feature. Trigger before production UI code, for generic or weak design feedback, or when material typography, composition, color, motion or responsive behavior is unsettled. Require targeted references, three distinct visible directions, owner approval, a design contract and a representative browser-verified slice. Do not trigger for small UI bug fixes, implementation of an approved contract or browser QA alone.
---

# Craft Web Interfaces

This is Major's single general interface-craft authority. The user's brief, project truth and existing design system outrank generic style preferences.

## Mandatory direction gate

Before material production UI code:

1. Translate the brief using [visual-direction-dossier.md](references/visual-direction-dossier.md).
2. Run targeted `research-product-patterns` research. Mobbin is preferred when relevant and available.
3. Produce three genuinely distinct systems: conservative, progressive and exploratory.
4. Build a visible moodboard for each direction with actual references.
5. Map every reference to a specific decision and state what is rejected.
6. Recommend one direction, but do not silently choose.
7. Wait for the owner to select, approve a coherent hybrid or explicitly delegate the choice.
8. Convert the approved direction into one design contract.
9. Prototype one representative vertical slice.
10. Verify the slice in a real browser before propagation.

If Mobbin is unavailable, continue with public references and record the missing evidence. Do not claim the full reference stage passed.

Persist the decision with `templates/project/DESIGN-DIRECTION.md` and require `major design check <record>` before broad production UI code. Approval is project-local evidence; do not rely on session memory.
External Figma or research URLs must be recorded in project-local evidence manifests so fresh sessions and independent graders can verify the same decision boundary.

## Coherent system

Each direction must define:

- visual character and user perception;
- color and contrast;
- typography, licensing and loading;
- layout, density and responsive transformation;
- navigation, buttons, inputs, tables/lists, filters, cards, panels and states;
- AI recommendation, approval and confirmation treatment;
- motion purpose, interruption, reversal and reduced-motion fallback;
- imagery, illustration, icons and diagrams;
- technical, accessibility, performance and implementation risks.

One thesis, grid, type system, spacing system, component language, motion philosophy and illustration philosophy must own each direction. Do not assemble a Frankenstein collage.

## Interaction contract

For each consequential interaction state:

1. user intent;
2. initial and final state;
3. frequency, commitment, directness and device/input mode;
4. whether motion is necessary;
5. spatial origin and destination;
6. interruption, reversal and cancellation;
7. reduced-motion behavior;
8. CSS before JavaScript when sufficient;
9. existing project animation stack before a new library;
10. real-browser verification.

Frequent utilities need little ceremony. Direct manipulation responds immediately. Destructive actions require explicit commitment or Undo. Motion must support comprehension, continuity or feedback.

## Mechanical interface quality

Apply [vercel-universal-interface-rules.md](references/vercel-universal-interface-rules.md) during implementation and review. These are framework-neutral quality checks adapted from the pinned MIT-licensed Vercel source. Do not impose Vercel's brand/copy preferences on another product.

Keep keyboard access, focus, semantics, forms, URL-backed state, loading stability, long content, reduced motion, layout shift, error recovery and duplicate-submission protection in the design contract.

## Approval output

Score each direction for comprehension, trust, distinctiveness, speed, technical/accessibility/performance risk, MVP fit and long-term potential. State confidence, key assumption, strongest alternative and what evidence would change the recommendation.

Do not start broad implementation until the approval gate is satisfied.

## Prototype and fidelity

Choose a slice that exposes navigation, primary layout, a dense list/table or form, one non-happy state, one important transition and one responsive transformation. Compare implemented screenshots with the approved direction. Record material differences and reasons.

Use `verify-in-browser` for functional, responsive, accessibility and visual evidence. Use `responsive-motion-systems` for GSAP, ScrollTrigger, pinned/sticky, parallax, Three.js or other geometry-sensitive motion.
