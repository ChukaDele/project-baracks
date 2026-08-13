# Storybook selection reference

Official sources checked 2026-08-13:

- https://storybook.js.org/docs/writing-tests/interaction-testing
- https://storybook.js.org/docs/writing-tests/integrations/vitest-addon

Use the current compatible version from the project's package registry at adoption time. Do not rely on the version recorded in this skill after it becomes stale.

Prefer existing component tests when they already cover browser-realistic behavior. Prefer page-level Playwright when component isolation does not simplify diagnosis or state coverage.
