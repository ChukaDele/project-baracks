# UI patterns, competitor learning and reuse rules

Major should not reinvent familiar product interaction patterns without a strong reason. For standard product UI, speed and usability come from learning from proven products, reusing established components and differentiating only where it creates user value.

## Before designing a material workflow

For a new product, page type or important interaction:

1. Identify 3-5 direct competitors or products solving a closely related workflow.
2. Add 2-3 adjacent best-in-class products when they solve the interaction better than direct competitors.
3. Inspect what users already understand: information hierarchy, tables/lists, filters, search, onboarding, status, empty states, navigation, bulk actions, forms, review flows, errors and recovery.
4. Extract the strongest reusable patterns and the reasons they work.
5. Record what should be reused, adapted, deliberately rejected or differentiated.
6. Stop research once the dominant pattern and useful exceptions are clear.

Learn from interaction patterns, hierarchy and workflow mechanics. Do not copy protected brand assets, proprietary content or distinctive trade dress.

## Standard product UI default

Use **shadcn/ui** as the default component primitive library for ordinary React/Next.js product interfaces unless the existing project design system or another proven library is clearly better.

Prefer existing accessible primitives for:

- buttons
- dialogs and sheets
- menus
- forms and validation surfaces
- selects/comboboxes
- tabs
- tables
- tooltips
- toasts
- popovers
- navigation primitives
- loading/skeleton states

Custom-build a primitive only when the user experience genuinely requires behaviour that the existing primitive cannot provide cleanly.

The goal is to spend creative/engineering effort on the product-specific workflow, not rebuilding generic UI infrastructure.

## Implementation order

1. Reuse a proven interaction pattern.
2. Use an existing component or maintained package.
3. Compose/customise the component to the product's needs.
4. Build custom infrastructure only when the first three options cannot meet the requirement.

For important choices with multiple credible approaches, prototype 2-3 small alternatives, compare them in the actual workflow and keep only the winner.

## Design quality

Even when using shadcn or another component library, the product should not look like an untouched starter template.

Customise:

- information density
- hierarchy
- typography
- spacing
- table/list behaviour
- status treatment
- action placement
- empty/error/recovery states
- product-specific navigation
- motion where it aids comprehension

Use the project's visual system and the complete Emil Kowalski design/motion skill bundle for user-interface work.

## Exploratory / Awwwards exception

When the project is explicitly exploratory, experimental, Awwwards/FWA-style, heavy-motion, immersive or illustration-led, switch to the exploratory creative-development profile.

In that mode, shadcn may still provide invisible low-level primitives where useful, but it must not dictate the visual language. The experience should be driven by the approved art direction, motion storyboard and signature interaction rather than standard SaaS composition.

## Visual verification

UI implementation is not complete because the DOM or component tests pass.

For meaningful UI changes, inspect the rendered experience in a browser/preview and check:

- hierarchy and composition
- clipping/overflow
- alignment and spacing
- realistic content/data density
- states and recovery
- motion/transition behaviour when relevant
- the critical user path

Prefer deployed-preview inspection for important flows so environment differences are caught early.