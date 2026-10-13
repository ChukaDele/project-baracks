---
title: Lenis scroll orchestration
type: reusable-capability
status: conditional-candidate
tags: [lenis, gsap, scrolltrigger, scroll, motion, accessibility, qa, web]
updated: 2026-10-13
---

# Lenis scroll orchestration

## Canonical decision
Lenis is an **optional project-specific smooth scrolling runtime** for coordinating wheel scrolling with GSAP ScrollTrigger, WebGL or complex scroll-driven effects. Never add it automatically to unrelated UIs, dashboards, forms, or every website. Native scrolling remains the baseline.

## Automatic skill selection
Major's **responsive-motion-systems** skill owns Lenis and scroll orchestration decisions. Canonical path: `skills/internal/responsive-motion-systems/SKILL.md`. The resolver load string includes `lenis` and `scroll-orchestration`, with positive and negative fixtures under `evals/skill-resolver/responsive-motion-systems.json`. No second Lenis design skill or separate UI build loop is authorised.

Selection examples:
- "Integrate Lenis with GSAP and ScrollTrigger on a scrollytelling page" → responsive-motion-systems.
- "Audit Lenis nested dialogs, mobile scroll and reduced-motion fallback" → responsive-motion-systems + website-design-qa where browser QA applies.
- "Implement this Figma design pixel perfectly" → existing Figma-to-code fidelity, with motion skill only if actual scroll orchestration is involved.
- "Build a standard admin dashboard" → use existing frontend skills; do not load Lenis.
- "Make this paragraph smoother" → no motion skill.

## Technical contract
1. Inspect native scroll, CSS `scroll-behavior`, current GSAP ticker/ScrollTrigger owners, nested scroll containers and accessibility state before installing anything.
2. Review and pin the tested Lenis package version in the **target project's** lockfile. Do not use floating latest builds or machine-global installations.
3. Keep one animation clock: `autoRaf: false`; `lenis.on('scroll', ScrollTrigger.update)`; `gsap.ticker.add(t => lenis.raf(t * 1000))`.
4. Preserve reduced-motion, touch-native input, anchors, focus, modal and nested scrolling. Teardown must remove ticker callbacks and listeners and restore native behavior.
5. Use an opt-in branch, native A/B, CI and HTTPS preview browser/device QA. Retain only when benefit is observed without perceptible lag or regression. Do not merge a prototype solely because lint/build passes.

## Current example
- Repo: https://github.com/ChukaDele/chuka-personal-site
- Draft PR: https://github.com/ChukaDele/chuka-personal-site/pull/12
- Pilot overview: `docs/lenis-pilot.md` in the personal-site branch.
- Site stack: Astro + GSAP ScrollTrigger + Three.js + native navigation and forms.
- Baseline: no URL flag. Desktop experimental path: `?lenis-preview=1` on a reviewed preview build only.

## Proof and caveats
- Personal-site CI passed at the 13 October 2026 pilot head, and the automated Playwright QA suite passed **10/10** on Chromium and WebKit: https://github.com/ChukaDele/chuka-personal-site/actions/runs/38382381672. Tests covered native baseline, explicit opt-in, anchor navigation, contact dialog, reduced motion and responsive teardown.
- Live Cloudflare HTTPS preview A/B, physical mobile devices, Safari hardware, and measured performance comparison are still release gates; automated engine checks do not establish these outcomes.
- No blanket approval to enable Lenis in production or other projects.
- This version-controlled page is the **GBrain-ready source record and metadata projection**, not confirmation that the local GBrain PGLite index has ingested it.
- GBrain runtime ingestion requires access to the user's Mac/MCP connection or an authorised remote GBrain write tool. Do not steal or break the live PGLite lock.

## Source and ownership
- Source project: user-owned personal site and Major engineering skillpack.
- Library: https://github.com/darkroomengineering/lenis (MIT); https://www.npmjs.com/package/lenis
- Canonical skill owner: responsive-motion-systems. Browser review: website-design-qa. Figma parity: official Figma workflow; reference replication: reference-replica; mobile/edge QA: Emil mobile-native and break-ui.

## Local GBrain ingestion after machine reconnection
This Git-owned source and the metadata-only index preserve the capability meanwhile. When the local GBrain service is available, use its existing MCP write tool if the PGLite server owns the database. Do not start a second DB process against the live lock. With the service stopped and the CLI owning the store, the documented import path is:

```sh
# Ingest the earlier UI Skills note from its local staging file or Git-backed copy.
if [ -s "$HOME/.gbrain/pending-import/ui-engineering-skills.md" ]; then
  gbrain put concepts/ui-engineering-skills < "$HOME/.gbrain/pending-import/ui-engineering-skills.md"
else
  gbrain put concepts/ui-engineering-skills < docs/gbrain/ui-engineering-skills.md
fi
# Then ingest this separate Lenis decision record from the reviewed Major checkout.
gbrain put major/capabilities/lenis-scroll-orchestration < docs/gbrain/lenis-scroll-orchestration.md
gbrain get major/capabilities/lenis-scroll-orchestration
gbrain search "Lenis scroll orchestration"
gbrain search "UI Engineering Skill Stack"
```

Verify that the page content is searchable before describing it as GBrain-indexed. After a reviewed Major release/installation, verify the existing motion skill automatically resolves an explicit Lenis/GSAP prompt and rejects unrelated admin UI/writing requests. Never override another agent's active lock or replace a working global skills installation blindly.
