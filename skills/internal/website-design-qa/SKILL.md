---
name: website-design-qa
description: Use for website, landing-page, marketing-site, frontend design, responsive QA, visual QA, production QA, Awwwards/FWA-style reviews, mobile-first review, browser debugging, launch readiness, live-site parity, performance or accessibility work. Treat 100% browser zoom as the canonical visual baseline; use breakpoints/capability modes for design changes and browser zoom as robustness QA. Pair with responsive-motion-systems whenever the site uses GSAP, ScrollTrigger, sticky/pinned storytelling, card stacking, hero video, parallax or Three.js.
---

# Website Design & QA

This is the default cross-project quality doctrine for customer-facing websites.

## 0. Prime directive

Design for normal use at **100% browser zoom**. Engineer for abnormal-but-valid use. A site is not correct because one desktop screenshot looks right. It is correct when the intended design survives real breakpoints, short viewports, browser zoom, mobile/touch, reduced motion, production routing and third-party scripts without losing hierarchy, functionality or craft.

## 1. Canonical visual baseline

Use **100% browser zoom** as the visual-design authority.

Canonical review matrix (adapt when the product has a documented device target):
- Large desktop: ~1728×1117
- Desktop: ~1440×900
- Laptop: ~1280×800
- Short laptop: ~1280×720
- Small desktop: ~1024×768
- Tablet: ~768×1024
- Large mobile: ~430×932
- Mobile: ~390×844

At 100%, judge both **visual quality and functionality**: composition, hierarchy, typography, spacing, interaction, narrative, affordance, content density, motion, focus and conversion path.

Do **not** tune the canonical design around a user's arbitrary 80%, 90% or 125% browser zoom.

## 2. Zoom is robustness QA, not a design mode

After canonical 100% states pass, stress-test representative windows at browser zoom levels such as:
- 67%
- 75%
- 80%
- 90%
- 100%
- 110%
- 125%

Zoom must not create:
- overlap
- clipping
- duplicate scenes
- broken sticky/pinned states
- stale animation geometry
- horizontal overflow
- unreadable typography
- trapped controls
- cards outside containers
- viewport-owner collisions

Never write `if zoom === 0.8`. Choose design mode from **actual available geometry**: container width/height, visual viewport, content measurements and motion preference.

## 3. Responsive design means recomposition

Author distinct capability modes where needed:
- MOBILE BASE
- TABLET
- SMALL DESKTOP
- SHORT DESKTOP
- DESKTOP ENHANCED
- REDUCED MOTION

A breakpoint may change layout, interaction, sticky behaviour, motion, reading order, density or visual treatment while preserving the design system and content meaning.

Do not build desktop and merely shrink it.

## 4. Relational geometry, not fixed-screen assumptions

Use the primitive that matches the relationship:
- CSS Grid: `fr`, `minmax()`, `auto-fit/auto-fill`
- Flexbox: `flex-basis`, grow/shrink
- Fluid bounds: `%`, `clamp()`, `min()`, `max()`
- Component-local responsiveness: container queries
- Viewport-relative units: `svh`, `dvh`, `dvw` only when the viewport is genuinely the reference
- Proportions: `aspect-ratio`
- Motion: normalized progress `0→1`, `xPercent`, `yPercent`
- Measured behaviour: `ResizeObserver`, `getBoundingClientRect()`, `clientWidth/Height`, `scrollWidth/Height`

Pixels are fine for things that are truly fixed: 1px borders, icon strokes, focus rings, small optical nudges and minimum touch targets. Pixels are not the primary architecture for major columns, viewport storytelling, large section heights or scroll runways.

## 5. Browser QA is mandatory

DOM/unit tests do not prove a website looks right.

For meaningful UI claims use:
- **Chrome DevTools** for live diagnosis: computed styles, console, network, layout, performance traces, source-mapped errors
- **Playwright** for repeatable E2E, breakpoint matrices, visual artefacts, geometry invariants and regression checks

When a user supplies a screenshot of a defect, treat it as ground-truth evidence. Build the reproduction case from it. Never answer `could not reproduce → no change` while credible visual evidence exists.

## 6. Live-site parity before diagnosis

Before comparing preview/staging and production:
1. confirm the exact deployed SHA/build fingerprint;
2. compare content-hashed CSS/JS assets;
3. verify DNS/redirect/caching state;
4. inspect production-only environment variables and third-party scripts;
5. test in a clean browser/incognito session.

A successful CI deploy is not proof the public domain serves the same build.

## 7. Fix the interaction; do not delete it

If an approved interaction breaks at a viewport or zoom level, repair the architecture or switch to a deliberate fallback mode. Removing the interaction merely to make QA pass is a regression unless the fallback was intentionally designed for that capability state.

For motion-heavy work, load and obey `responsive-motion-systems`.

## 8. Modular frontend ownership

Each high-risk feature should own its layout, browser measurement, motion lifecycle, cleanup, responsive modes and reduced-motion fallback. Examples:
- HeroVideo
- FiveSystemsScene
- ReferenceWorkScene
- ExperienceRows
- InvisibleQueryScene
- AdaptiveHeader
- ArticleTOC

Avoid a global controller that reaches into every section and accumulates hidden coupling.

## 9. Lazy loading and server-first delivery

Keep critical marketing/SEO content server-rendered and crawlable.

Lazy-load expensive capability only where needed:
- GSAP/ScrollTrigger on routes/components that use it
- Cal only on Schedule
- phone/country utilities only on Contact
- below-fold interactive tools/visuals where appropriate
- the correct hero media variant only

Do not lazy-load critical navigation, headings or above-fold copy. Avoid creating a waterfall of tiny client chunks.

## 10. Production QA lanes

Review independently across:
- VISUAL / art direction
- RESPONSIVE / mobile-first
- MOTION / scroll ownership
- FUNCTIONAL journeys
- COPY / ICP clarity
- ACCESSIBILITY
- PERFORMANCE
- SEO / crawlability
- ANALYTICS / consent
- PRODUCTION routing/cache

For customer-facing sites, a complete pass includes real navigation, forms, scheduling/checkout if present, 404, footer, browser back/forward, keyboard, touch, reduced motion and production domain behaviour.

## 11. Whitespace and composition

Whitespace must separate ideas, not hide unfinished layout.

For unusually large vertical gaps, classify them:
- intentional narrative pause; or
- accidental min-height, sticky footprint, pin spacer, empty container or stale layout.

Fix accidental gaps. Do not densify intentionally spacious design merely to fit more into one viewport.

## 12. Typography and scanning

Use container-aware measures and fluid type. Long-form content should optimize line length, hierarchy and scanning. Large display type must respect its local column/container rather than inheriting a global viewport scale that can overlap adjacent content.

## 13. Accessibility is part of craft

Require:
- semantic headings/landmarks
- focus-visible
- keyboard navigation
- touch-safe targets
- sufficient contrast
- meaningful image/diagram semantics
- form labels/errors
- reduced-motion states
- no hover-only critical information

Meaningful visuals should expose what they communicate; decorative visuals should be hidden from assistive tech.

## 14. Performance is part of premium UX

Measure at least the major landing pages and high-traffic templates. Investigate:
- LCP candidate
- CLS
- interaction responsiveness
- third-party cost
- fonts
- hero media
- animation JS
- route bundles
- long tasks
- hydration

Do not destroy the design to chase a vanity 100/100 score. Fix evidenced bottlenecks.

## 15. Regression after real bugs

For every costly/recurrent bug:
1. reproduce;
2. identify root cause;
3. fix;
4. verify preview;
5. verify production;
6. add the cheapest durable regression guard;
7. promote the reusable lesson only after independent review.

Prefer invariant tests for architecture rules and screenshot baselines for canonical 100% visual states.

## 16. Release gate

Do not call a website ready because `build` passed. Require evidence appropriate to risk, including:
- canonical 100% breakpoint matrix
- zoom robustness matrix for high-risk layouts
- no broken links/assets/console errors
- critical journey success
- staging/production parity
- accessibility P0/P1 clean
- performance P0/P1 reviewed
- SEO/canonical/robots/sitemap/schema sanity
- analytics/consent verified when configured

When motion-heavy design exists, `responsive-motion-systems` is mandatory alongside this skill.
