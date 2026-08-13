---
name: responsive-motion-systems
description: Use whenever frontend work involves GSAP, ScrollTrigger, sticky/pinned scenes, scrollytelling, card stacking, hero video, viewport animation, scroll scrub, parallax, Three.js, matchMedia, ResizeObserver or zoom-sensitive motion. Preserve approved interactions, use one viewport owner per overlapping narrative region, relational geometry and explicit handoffs. Canonical visual design is judged at 100% browser zoom; zoom levels are robustness tests, not bespoke design modes.
---

# Responsive Motion Systems

Verified production doctrine distilled from the Bredge Reference Work / Invisible-90% collision incident.

## 0. Fix the interaction; never remove it

If an approved motion interaction fails on a viewport, zoom level or device, repair its architecture or use a deliberate fallback mode. Deleting the interaction merely to remove the symptom is a regression.

## 1. Canonical design vs robustness

**100% browser zoom is the canonical visual baseline.** Tune visual quality at the intended breakpoints at 100% first.

Then stress-test native browser zoom such as 67 / 75 / 80 / 90 / 100 / 110 / 125%. Zoom is a robustness dimension, not a design target. Do not build an `80% design` or detect zoom directly to choose UI.

Choose UI from live geometry: container width/height, visual viewport, content measurements and motion preference.

## 2. Relational geometry, not fixed-screen assumptions

Use:
- Grid `fr`, `minmax()` and container queries
- flex grow/shrink/basis
- `%`, `clamp()`, `min()`, `max()`
- `svh/dvh` only when viewport-relative behaviour is genuinely intended
- `aspect-ratio`
- normalized progress `0→1`
- GSAP `xPercent` / `yPercent`
- `ResizeObserver`, `getBoundingClientRect()`, `clientWidth/Height`, `scrollWidth/Height`

Pixels are for genuinely fixed micro-details, not the architecture of viewport storytelling.

## 3. Banned patterns

Do not use fixed values tuned to one screen as the narrative architecture, such as:
- multiple independent sticky cards with fixed `top` offsets;
- universal hard-coded ScrollTrigger runways like `end: "+=2800"`;
- large fixed `left/top/height` values used to position story elements;
- multiple independent pinned/sticky systems that can own the same viewport region with no explicit handoff.

## 4. One viewport owner per overlapping region

Exactly one authored sticky/pinned scene may own an overlapping narrative region at a time.

The current scene owns the viewport until it ends, then **releases completely** before the next scene may pin.

Encode this release contract explicitly. Add a development/regression invariant when recurrence would be costly.

## 5. Capability-based design modes

Enhanced motion should be enabled only when all relevant conditions allow it:
- usable component width;
- usable viewport/container height;
- motion preference;
- content geometry.

Author distinct modes:
- MOBILE BASE
- TABLET
- SMALL DESKTOP
- SHORT DESKTOP
- DESKTOP ENHANCED
- REDUCED MOTION

A zoom change may legitimately push the component into a different capability mode. That is fine if the fallback is intentionally composed and complete.

## 6. ScrollTrigger rules

For geometry-dependent scenes:
- compute `start` / `end` dynamically from live geometry;
- use `invalidateOnRefresh: true`;
- use `gsap.matchMedia()` / scoped contexts for responsive setup and cleanup;
- kill old triggers before recreating;
- leave no stale pin spacer, fixed positioning or inline transform after teardown;
- refresh after geometry changes rather than assuming one initial measurement stays valid.

## 7. Geometry coordinator

Use one debounced/coordinated response to relevant changes such as:
- `visualViewport` resize;
- `window` resize;
- orientation change;
- `document.fonts.ready`;
- relevant `ResizeObserver` changes.

Recompute measurements, change design mode if needed, then refresh ScrollTrigger. Avoid refresh loops.

## 8. Modular scene ownership

Each authored scene owns its own:
- layout;
- motion lifecycle;
- browser measurement;
- cleanup;
- responsive modes;
- reduced-motion fallback.

A global PageMotion/controller may coordinate but should not secretly own every section's internals.

## 9. Browser debugging workflow

Use Chrome DevTools for exploratory live diagnosis and Playwright for deterministic regression.

For a production visual bug:
1. confirm `/__build` or equivalent deployed SHA;
2. open the live domain in a clean headed browser;
3. reproduce the user's viewport and zoom;
4. capture screenshot;
5. inspect computed styles;
6. enumerate active ScrollTriggers/sticky owners;
7. capture relevant bounding boxes;
8. inspect console;
9. inspect network;
10. identify root cause;
11. fix;
12. verify preview;
13. deploy;
14. repeat exact live reproduction;
15. add a regression guard.

A user screenshot is evidence. Do not dismiss it because one automated geometry check passes.

## 10. QA hierarchy

### Canonical visual QA
At 100% zoom, review representative viewports such as:
- 1728×1117
- 1440×900
- 1280×800
- 1280×720
- 1024×768
- 768×1024
- 430×932
- 390×844

Judge composition, interaction, hierarchy, typography, spacing and craft.

### Robustness QA
Stress representative windows at zoom levels including 67/75/80/90/100/110/125 and around meaningful breakpoint boundaries.

Judge:
- no overlap;
- no clipping;
- no duplicate scenes;
- no horizontal overflow;
- no stale sticky/pin state;
- correct capability-mode selection;
- coherent narrative.

Zoomed states do not need identical line breaks or proportions to the canonical 100% state. They must remain intentionally composed.

## 11. Visual baselines and invariants

Use canonical 100% states as screenshot/visual-design baselines.

Use historical zoom failures as mandatory structural regression cases.

Prefer geometric/invariant tests for architecture rules such as:
- at most one viewport owner;
- current scene releases before next pins;
- headline does not intersect adjacent panel;
- no horizontal overflow;
- all cards/states remain reachable.

Use visual screenshots as complementary evidence, not the only proof.

## 12. Staging/production parity

Before diagnosing a prod-vs-preview visual mismatch:
- confirm exact build SHA;
- compare content-hashed assets;
- verify DNS/redirect/cache state;
- inspect production-only scripts and environment configuration.

A deployment command reporting success is not proof the public hostname serves the intended build.

## 13. Failure conditions

The system is broken if any of these occur:
- two pinned/sticky narrative scenes visibly co-occupy a viewport;
- a scene remains stuck after its section has ended;
- a headline overlaps an adjacent panel under zoom;
- horizontal overflow appears under zoom;
- a fallback silently removes an approved interaction without a designed capability reason;
- a user-provided screenshot shows a defect that automated QA declares impossible.

When this skill triggers, pair it with `verify-in-browser` for the broader site-quality pass.
