# UI patterns, competitor learning and reuse rules

Major should not reinvent familiar product interaction patterns without a strong reason. For standard product UI, speed and usability come from learning from proven products, proving the flow visually, reusing established components and differentiating only where it creates user value.

## Before designing a material workflow

For a new product, page type or important interaction:

1. Identify 3-5 direct competitors or products solving a closely related workflow.
2. Add 2-3 adjacent best-in-class products when they solve the interaction better than direct competitors.
3. Inspect what users already understand: information hierarchy, tables/lists, filters, search, onboarding, status, empty states, navigation, bulk actions, forms, review flows, errors and recovery.
4. Extract the strongest reusable patterns and the reasons they work.
5. Record what should be reused, adapted, deliberately rejected or differentiated.
6. Stop research once the dominant pattern and useful exceptions are clear.

Learn from interaction patterns, hierarchy and workflow mechanics. Do not copy protected brand assets, proprietary content or distinctive trade dress.

## Figma-first flow proof

For meaningful new workflows, use Figma or an equivalent lightweight prototype when it can resolve interaction, hierarchy or stakeholder-alignment uncertainty faster than code.

Prototype the complete critical flow rather than isolated pretty screens. Include the states needed to reason about the product: loading, empty, selected, error, success, review, confirmation and recovery where relevant.

Treat the approved prototype as an implementation reference for:

- screen and navigation sequence;
- information architecture;
- hierarchy and action placement;
- required data fields and states;
- interaction behaviour;
- copy intent;
- acceptance criteria.

The prototype is allowed to be ahead of infrastructure. It exists to make the intended system concrete before deep implementation and to give stakeholders something visible to critique at all times.

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
2. Prove important flow/interaction uncertainty in Figma or a small prototype.
3. Use an existing component or maintained package.
4. Compose/customise the component to the product's needs.
5. Build the rendered frontend against realistic fixtures or a mock adapter if that provides faster visible progress.
6. Connect the real backend through the agreed contract as it becomes available.
7. Build custom infrastructure only when the earlier options cannot meet the requirement.

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

Use the project's visual system and the **complete Emil Kowalski design/motion skill bundle** for user-interface work. Install the full approved Emil bundle into Major's reusable skill library and trigger only the task-relevant skills in active context.

## Exploratory / Awwwards exception

When the project is explicitly exploratory, experimental, Awwwards/FWA-style, heavy-motion, immersive or illustration-led, switch to the exploratory creative-development profile.

In that mode, shadcn may still provide invisible low-level primitives where useful, but it must not dictate the visual language. The experience should be driven by the approved art direction, motion storyboard and signature interaction rather than standard SaaS composition.

## Visual verification and visible progress

UI implementation is not complete because the DOM or component tests pass.

Maintain something demonstrable throughout delivery: first the Figma flow, then the rendered UI, then the connected integration, then the real end-to-end path.

For meaningful UI changes, inspect the rendered experience in a browser/preview and check:

- hierarchy and composition
- clipping/overflow
- alignment and spacing
- realistic content/data density
- states and recovery
- motion/transition behaviour when relevant
- the critical user path

Prefer deployed-preview inspection for important flows so environment differences are caught early.