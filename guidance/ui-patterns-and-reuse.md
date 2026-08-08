# UI patterns, competitor learning and reuse rules

Major should learn from what already works before inventing a new product interaction. Standard product UI optimises for speed, familiarity and clarity; exploratory work may deliberately break convention.

## Before material UI work

1. Inspect 3–5 direct competitors or close workflow analogues.
2. Add 2–3 adjacent best-in-class products when they solve the interaction better.
3. Study real workflow mechanics: hierarchy, navigation, lists/tables, filters, search, onboarding, statuses, empty states, bulk actions, forms, review, errors and recovery.
4. Extract what to adopt, adapt, reject or differentiate.
5. Stop research once the dominant pattern and useful exceptions are clear.

Learn from patterns and mechanics; do not copy protected brand assets or distinctive trade dress.

## Proof the flow cheaply

Use the cheapest useful proof medium for interaction uncertainty: Figma, a coded prototype, Storybook, a local page, realistic fixtures, screenshots, or another fast artefact. Prototype the **critical workflow**, not just pretty isolated screens.

A prototype may be ahead of backend infrastructure and can serve as an implementation reference for sequence, hierarchy, data requirements, states, actions and acceptance criteria.

## Standard product UI default

For ordinary React/Next.js products, use **shadcn/ui** as the default primitive library unless an existing design system or another proven library is clearly better.

Reuse accessible primitives for buttons, dialogs/sheets, menus, forms, comboboxes, tabs, tables, tooltips, toasts, popovers, navigation, loading/skeleton states and similar commodity UI.

Spend custom engineering effort on product-specific workflows, not generic components.

## Implementation order

1. reuse a proven interaction pattern;
2. prove meaningful uncertainty quickly;
3. use a maintained component/package;
4. compose/customise it to the product;
5. render with realistic fixtures/mocks when that creates faster progress;
6. connect real backend through the contract as it becomes available;
7. build custom infrastructure only when prior options cannot meet the requirement.

For consequential UI choices with multiple credible options, build 2–3 small alternatives and keep only the winner.

## Design quality

Using shadcn must not produce an untouched starter-template look. Deliberately shape density, hierarchy, typography, spacing, status treatment, action placement, empty/error/recovery states, navigation and meaningful motion.

Use the **complete Emil Kowalski design/motion skill bundle** for UI work, with only task-relevant skills loaded into active context.

## Exploratory exception

For explicitly exploratory, experimental, Awwwards/FWA-style, heavy-motion, immersive or illustration-led work, activate `exploratory-creative-dev`. shadcn may supply invisible primitives but must not dictate visual language.

## Visual verification

Meaningful UI changes require rendered browser/preview inspection: hierarchy, composition, alignment, overflow, realistic density, states/recovery, motion when relevant and the critical user path. Prefer deployed-preview inspection for important flows.