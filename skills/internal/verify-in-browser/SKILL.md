---
name: verify-in-browser
description: Verify a meaningful web interface, deployed preview, responsive change, interaction, accessibility behavior, visual regression or production release in a real browser. Trigger for frontend acceptance, browser debugging, visual QA, responsive/mobile/ultra-wide checks, console/network inspection and screenshot evidence. Do not trigger for backend-only changes, static document review or unit-test-only tasks with no rendered behavior.
---

# Verify in Browser

## Target gate

Use the project's existing browser harness first. Under Major, browser acceptance is remote-first: run `remote-first-web-development` and `major web preflight` before opening the GitHub-backed Cloudflare preview. A local target requires the owner's project-specific exception.

Confirm the exact deployed SHA or build fingerprint before diagnosing preview/production differences.

## Verification contract

Check the applicable items:

- page loads and critical navigation;
- no unexpected console errors;
- no failed required network requests;
- keyboard flow and visible focus;
- loading, empty, sparse, dense, error and success states;
- long and user-generated content;
- representative desktop and narrow viewports;
- ultra-wide or short viewport when relevant;
- reduced motion;
- rapid repeated interaction and duplicate submission;
- cancellation, reversal or rollback;
- screenshots plus functional assertions.

For motion-heavy geometry, also run `responsive-motion-systems`.

## Evidence

For each failure or pass record:

```text
Expected state:
Observed state:
Viewport/input/motion setting:
Exact URL and build SHA:
Console/network result:
Screenshot or trace:
Functional assertion:
Likely cause and source location:
Category: functional | responsive | accessibility | performance | polish
```

Use screenshot baselines selectively for stable important interfaces. Mask volatile content and use deterministic fixtures. A screenshot alone does not prove the workflow; pair it with assertions.

## Visual fidelity

When an approved design direction exists, compare the implementation with its moodboard and design contract. Record material differences and why they were necessary. Grade coherence, reference alignment, typography, color, spacing, components, motion, responsive behavior, accessibility and performance.

## Completion

Do not declare ready from compilation, unit tests, a deployment command or one desktop screenshot. Require observable browser behavior and an independent grader when Product mode or blast radius requires it.

Read [references/browser-matrix.md](references/browser-matrix.md) for a default viewport and robustness matrix.

For public launch, production promotion, marketing, account, form, scheduling, checkout or SEO-sensitive work, also read [references/production-release.md](references/production-release.md). These release checks are not implied by a screenshot pass.
