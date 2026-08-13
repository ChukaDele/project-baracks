# Universal interface rules

Source: `vercel-labs/web-interface-guidelines` at `4e799d45c17aec1498c269287a83b9dba22b966b`, MIT. Adapted for Major. Vercel-specific brand and copy preferences are not adopted as universal policy.

## Accessibility and input

- Use semantic HTML before ARIA.
- Label every control. Give icon-only actions an accessible name.
- Preserve keyboard operation and visible `:focus-visible` treatment.
- Give images useful alternative text, or an empty alternative when decorative.
- Announce material asynchronous feedback with an appropriate live region.
- Do not block paste or disable zoom.

## Forms and state

- Use meaningful names, autocomplete, input types and input modes.
- Keep labels clickable and errors adjacent to their controls.
- Focus the first invalid field after submission.
- Prevent duplicate submissions while the request is active.
- Warn before losing unsaved changes.
- Put filters, tabs, pagination and other shareable state in the URL when appropriate.
- Make destructive actions reversible or explicitly confirmed.

## Layout, content and performance

- Handle empty, sparse, dense and very long user content.
- Give flex children `min-width: 0` when text must truncate.
- Set image dimensions to limit layout shift; prioritize only critical above-fold assets.
- Avoid layout reads during render and interleaved DOM reads/writes.
- Virtualize or otherwise bound large collections.
- Use locale-aware date, number and currency formatting.

## Motion and interaction

- Honor reduced motion.
- Prefer transform and opacity; list transitioned properties explicitly.
- Make animation interruptible and responsive to fresh user input.
- Define hover, active and focus states with stronger feedback than rest.
- Use direct links for navigation and buttons for actions.
- Account for touch targets, overscroll, safe areas and mobile autofocus.

## Hydration and themes

- Keep server and client rendering stable for dates, times and controlled inputs.
- Use hydration suppression only for intentionally different content.
- Declare color scheme and theme color consistently with the rendered theme.

## Review output

Report the source file and line, the observed risk and the smallest repair. A mechanical checklist cannot select product direction or override the approved design contract.
