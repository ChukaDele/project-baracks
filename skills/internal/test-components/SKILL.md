---
name: test-components
description: Decide whether and how to use isolated component stories and interaction tests for a React component system. Trigger for reusable components with meaningful states, repeated regressions, design-system work, or interaction-heavy forms, tables, filters, dialogs and menus. Do not trigger for small static sites, trivial components, adequate existing component coverage or workflows better proven by page-level browser tests.
---

# Test Components

## Adoption decision

Use Storybook only when isolated component development and state coverage will repay its setup and maintenance cost. Run `research-before-build` before adding it to a project.

Current checked reference: Storybook Vitest addon 10.5.7, MIT, Vitest 3/4, requiring a Vite-based Storybook framework or Next.js with `@storybook/nextjs-vite`.

Do not add Storybook to Major itself. Major has no React component surface.

## Pilot first

Before propagation, implement one representative interactive component with meaningful default, loading, empty, error, success, disabled, long-content and dense-content states. Include keyboard flow and reduced motion when relevant.

Use:

- story `play` functions;
- `userEvent` for clicks, typing, keyboard and submission;
- `getByRole`, `getByLabelText` and `getByText` before test IDs;
- user-observable outcomes rather than implementation details;
- the Vitest addon in real browser mode when the project supports it.

Do not duplicate full end-to-end journeys in Storybook. Keep page routing, backend integration and cross-page state in `verify-in-browser` tests.

## Visual evidence

Use free Playwright screenshot comparisons for stable important states. Mask volatile content or use deterministic fixtures. Do not require a paid Chromatic plan.

## Acceptance

- The adoption record shows why existing tests are insufficient.
- One representative component proves the setup before propagation.
- CI runs the interaction tests.
- Failures name the expected and observed user state.
- The project has an explicit removal path if story maintenance exceeds value.

Read [references/storybook-selection.md](references/storybook-selection.md) before installation.
