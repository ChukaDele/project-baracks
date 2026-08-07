# Major harness migration

This branch evolves the existing Major repository into the cross-project engineering harness it was originally intended to be.

The old repository is preserved in-place so its Git history, guidance, security work, routing logic and lessons remain auditable. Do not delete the old implementation until each useful capability has been classified as retained, adapted, superseded or rejected.

## Architectural role

Major is the operating system and human-reviewable source of engineering policy.

Ruflo is an orchestration/memory/learning substrate beneath Major. Claude Code, Codex, Google Antigravity CLI and Cursor Agent CLI are worker capacity. Individual product repositories such as JSS remain projects consumed/supervised by Major; they do not own Major.

## Retain from old Major

- instruction precedence and supersession/version history
- secret redaction and execution containment concepts
- explicit human authority for genuinely irreversible/high-risk actions
- durable task/run/evidence ledger
- model-level routing rather than provider-brand hard-coding
- orthogonal model state: visible, authenticated, available/rate-limited/exhausted, billing mode, prohibited
- subscription-included vs credits/API billing awareness
- task dependencies as explicit data rather than prose
- objective completion evidence rather than agent self-report
- configurable project boundaries and protected resources

## Adapt

- Replace the hard-disabled live execution foundation with Ruflo-backed orchestration and native provider CLIs.
- Make agent count adaptive: normal substantive builds should exploit useful parallelism; the system may scale to 8 normal development workers while contracting for small/local work.
- Use isolated worktrees and explicit write ownership for concurrent implementation.
- Replace the old Codex-review-only reserve with task-fit routing: Codex can be a primary implementation lane as well as an independent reviewer.
- Add Google Antigravity CLI as a lower-cost/subscription-capacity execution lane for bounded implementation, research, tests, documentation, browser work and overflow where appropriate.
- Add Cursor Agent CLI as another headless execution/review lane and model-capacity fallback.
- Prefer subscription-included capacity before any paid API route; paid API/credit usage remains a separate explicit authority decision.
- Keep bounded retry/repair loops. After two materially unchanged failed strategies, change strategy or escalate rather than repeat.
- Allow safe autonomous local work, branches, worktrees, tests and evidence collection. Revisit which merge/deploy actions require human approval instead of inheriting the old blanket prohibition unchanged.

## Import from newer project learnings

JSS currently contains a stronger reusable engineering corpus than old Major. Migrate its transferable material into Major's canonical global skill/memory library, including:

- project-start
- competitive-product-audit
- open-source-leverage
- nontechnical-ux
- simple-modular-code
- lean-graph-engineering / graph-engineering
- behavior-reward-system
- vertical-slice-delivery
- root-cause-qa
- exact-head-pr-review
- rapid-ui-prototype
- data-learning-loop
- source-adapter-engineering
- pdf-reporting-qa
- cost-control
- the lean quality/evidence strategy
- inherited reusable lessons from JSS `LEARNINGS.md`
- the complete approved external skill bundle (Emil, Anthropic, OpenAI, graph-engineering)

Do not migrate JSS-specific business rules, credentials, candidate data or domain state into Major global memory.

## Skill loading

Major may install a broad reusable skill library, but agents should load only trigger-matched skills into active context. Availability is not context injection.

Maintain a lock/manifest containing source, commit/version, licence status and installed capability.

## Exploratory / Awwwards profile

When a project is explicitly described as exploratory, experimental, Awwwards/FWA-style, heavy-motion, illustrative or similarly creative, activate a dedicated creative-development profile rather than normal product-UI defaults.

The profile should:

- study a small set of exceptional live references and reverse-engineer composition, typography, pacing, motion, interaction, illustration/3D and transition language
- define an explicit visual grammar and motion storyboard
- prototype the hardest/signature interaction before commodity page structure
- use specialised parallel agents for creative direction, layout/frontend, motion, WebGL/3D when justified, performance and browser/visual QA
- deploy previews early and visually inspect the rendered result, iterating until the experience meets the intended bar
- reject generic AI/SaaS design defaults, gratuitous animation and gratuitous 3D

Baseline runtime/tooling for this profile: Figma/references, image generation/SVG, GSAP + ScrollTrigger, Lenis, Motion, GitHub, Vercel and browser/Playwright QA. Add Three.js/React Three Fiber, Rive, Spline or Remotion only when the concept actually requires them.

Create a dedicated `exploratory-creative-dev` skill that orchestrates these existing capabilities rather than duplicating all underlying skill text.

## Global memory

Human-reviewable policy, approved skills and verified reusable lessons live in this repository. Ruflo/AgentDB may index them for semantic retrieval but is a derived retrieval layer rather than the only source of truth.

Project-local memories remain namespaced/project-local. Only sanitized transferable learnings may be promoted globally.

## Decisions still requiring approval

1. Exact canonical recurring skill bundle.
2. Which old Major approval gates remain human-only versus safe autonomous actions.
3. Default provider/task routing weights and concurrency policy.
4. Global-memory promotion threshold and review flow.
5. Exact exploratory/Awwwards skill wording and automatic runtime dependency install policy.
