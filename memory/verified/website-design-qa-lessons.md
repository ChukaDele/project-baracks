# Verified website design and QA lessons

Promoted from the Bredge production incident and subsequent regression work in August 2026. These lessons are reusable across projects and exclude project-specific business data.

1. **100% browser zoom is the canonical visual-design baseline.** Tune the intended breakpoint designs at 100%; browser zoom is a robustness test, not a bespoke design mode.
2. **Responsive design is recomposition, not shrinking.** Mobile, tablet, short-desktop, desktop-enhanced and reduced-motion states may legitimately change layout, interaction, sticky behaviour, reading order and density while preserving the same design system and meaning.
3. **Choose design mode from live geometry, not zoom percentage.** Use container width/height, visual viewport, content measurements and motion preference. Never write special UI logic for `80% zoom`.
4. **Relational geometry beats fixed-screen assumptions.** Prefer Grid/Flex ratios, `minmax()`, `clamp()`, container queries, aspect ratio, measured dimensions and normalized progress over fixed viewport-position constants.
5. **One viewport owner per overlapping scroll narrative.** A sticky/pinned scene must release completely before the next scene can own the same viewport region.
6. **Fix approved interactions; do not delete them to make bugs disappear.** Use a deliberate fallback only when the capability state cannot support the enhanced interaction.
7. **Dynamic scroll geometry is mandatory for responsive scrollytelling.** ScrollTrigger start/end values should derive from live content/viewport geometry and refresh when that geometry changes.
8. **Browser zoom is first-class QA.** Stress representative desktop windows across 67/75/80/90/100/110/125%, especially around meaningful breakpoint boundaries, and require no overlap, clipping, duplicate scenes, horizontal overflow or stale pinned state.
9. **Canonical screenshots come from 100% zoom.** Zoom-specific regressions are structural stress cases, not the visual master.
10. **Use real browser evidence for meaningful UI claims.** DOM/unit tests cannot prove visual correctness. Use Chrome DevTools for live diagnosis and Playwright for repeatable breakpoint/geometry/visual regression.
11. **User screenshots are evidence.** If a user can reproduce a visual defect, build the repro from that evidence rather than dismissing it because one automated check passes.
12. **Production and preview are different systems until parity is proven.** Confirm exact build SHA, content-hashed assets, DNS/redirect/cache state and production-only scripts before attributing differences to application code.
13. **Modular scene ownership reduces regressions.** High-risk interactions should own their layout, measurements, lifecycle, cleanup, responsive modes and reduced-motion fallback instead of relying on a global controller with hidden coupling.
14. **Large typography must respect its local container.** Do not let a global viewport-scaled heading overflow a narrower local grid column under zoom or responsive changes.
15. **Whitespace must be intentional.** Large empty fields need a narrative purpose; otherwise inspect min-heights, sticky footprints, pin spacers, empty containers and stale layout state.
16. **Performance, accessibility, SEO and production routing are part of website craft.** A site is not launch-ready because the visual design looks right in one browser.
17. **After a costly visual bug, add the cheapest durable invariant/regression guard.** Prefer architecture assertions for structural rules and canonical 100% screenshots for visual baselines.
18. **Skills compound only when installed into the control layer.** The detailed rules live in Major skills (`verify-in-browser` and `responsive-motion-systems`); this memory file records the verified cross-project lessons.
