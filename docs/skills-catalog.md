# Major skill catalog

This is the human-reviewable catalog for the recurring Major skill library.

**Policy:** Major can own a broad library, but project/worker context receives only the relevant profile and triggered specialist skills. External skills are subordinate to active Major guidance.

## Major internal skills — 28

These are canonical Major-owned skills.

| Skill | Use |
|---|---|
| `project-start` | Start a new/existing repo from outcome, current state and fastest proof. |
| `mvp-speed-prioritisation` | Reduce large briefs to P0 MVP / P1 / P2 and build P0 end to end. |
| `legacy-cleanup` | Finish migrations with one canonical path and remove stale active artefacts. |
| `skill-resolver` | Select only the small set of task-relevant skills; audit overlap/reachability. |
| `learning-capture` | Harvest explicit corrections/repeated mistakes after fixing the real task; classify project/global/policy/skill/memory. |
| `skillify` | Turn a successful reusable procedure into a tested skill pack after the real task works. |
| `tools-as-code` | Compose repeated deterministic retrieval/filter/dedupe/rank/transform mechanics with short temporary code. |
| `dev-server-management` | Allocate/reuse stable per-project local dev ports and prevent 3000/3001 collisions across simultaneous projects. |
| `source-ingestion` | Retrieve named primary sources with the right connector/CLI/browser/local tool before analysis. |
| `knowledge-work` | Research/strategy/synthesis with minimum credible evidence, independent angles and skeptic review where justified. |
| `competitive-product-audit` | Learn direct/adjacent product patterns before reinventing workflows. |
| `open-source-leverage` | Reuse/adapt/wrap maintained systems before commodity rebuilds. |
| `simple-modular-code` | Small replaceable modules; stable contracts; simple code. |
| `vertical-slice-delivery` | Build the smallest complete user/operational outcome. |
| `nontechnical-ux` | Plain-language, low-friction workflows for non-technical users. |
| `lean-graph-engineering` | Explicit dependencies, parallel branches, verifiers, repair loops and human gates. |
| `behavior-reward-system` | Reward outcomes/evidence/root-cause/reuse/simplicity, not activity. |
| `root-cause-qa` | Reproduce, find earliest wrong assumption, fix cause, verify. |
| `ci-recovery` | Diagnose and autonomously repair failing CI/PR checks. |
| `lean-quality` | Confidence per minute; risk-proportional testing. |
| `performance-caching` | Measure real slowness; apply simplest cache/index/lazy-load/batch fix. |
| `exact-head-pr-review` | Review the exact immutable head/artefact before readiness claims. |
| `rapid-ui-prototype` | Compare 2–3 interaction options when the UI choice matters. |
| `data-learning-loop` | Outcome learning without leakage, false causality or uncontrolled rule changes. |
| `source-adapter-engineering` | Modular APIs/scrapers/feeds with provenance, retries and dedupe. |
| `pdf-reporting-qa` | Reliable generated PDF reports with visual QA. |
| `cost-control` | Subscription/rate-limit/paid-spend routing and usage discipline. |
| `exploratory-creative-dev` | Awwwards/FWA/heavy-motion/immersive creative-development workflow. |

## Skill-pack standard

A procedure becomes durable only after the real task works. `skillify` then prefers this bundle when justified:

1. `SKILL.md` — intent, judgment, trigger conditions, procedure and stop conditions;
2. minimal deterministic code only where I/O/transformation/validation benefits from certainty;
3. unit tests for deterministic code when present;
4. representative skill eval;
5. resolver positive/negative/near-neighbour cases;
6. integration/E2E smoke test when code and markdown interact;
7. filing/memory rules separating reusable knowledge from project-sensitive context.

Learning priority:

`explicit correction → fix/verify → candidate capture → deterministic rule/tool → tested skill → memory`

Rules prevent. Skills institutionalize. Memory reminds.

## Emil Kowalski complete bundle — 9

For UI projects, install the **complete current upstream bundle**, not a hand-picked frozen subset. Current bundle at validation time:

1. `animate`
2. `animation-vocabulary`
3. `apple-design`
4. `emil-design-eng`
5. `find-animation-opportunities`
6. `improve-animations`
7. `pick-ui-library`
8. `prototype`
9. `review-animations`

If Emil adds/removes skills later, the installer records the upstream commit and installs the current bundle. Major's lock file makes the change reviewable.

## Anthropic recurring external skills

| Skill | Profile | Why |
|---|---|---|
| `frontend-design` | UI/Web | Strong frontend design guidance. |
| `webapp-testing` | UI/Web | Browser/app testing workflows. |
| `mcp-builder` | MCP/integration task | Build/evaluate MCP servers and tool contracts. |
| `skill-creator` | Major/skill-authoring task | Create/evaluate/improve reusable skills. |
| `algorithmic-art` | Exploratory | p5.js generative art, particles, fields and interactive parameters. |

## OpenAI recurring external skills

| Skill | Profile | Why |
|---|---|---|
| `playwright` | UI/Web | Real-browser automation and debugging. |
| `vercel-deploy` | Vercel/Web | Fast preview deployments; production remains policy-controlled. |
| `figma-use` | Figma task | Safe/programmatic Figma reads/writes. |
| `figma-implement-design` | Figma → code | Translate approved Figma design into code. |
| `figma-generate-design` | code/brief → Figma | Build/update screens in Figma when Figma is the useful proof medium. |
| `security-threat-model` | material security task | Deep security analysis only when risk justifies it. |
| `pdf` | PDF task | General PDF capability. |

## Deep graph skill

- `graph-engineering` from `codejunkie99/graph-engineering` — load only when Major's lean graph skill is insufficient and the workflow genuinely needs deeper graph modeling/orchestration.

## Major tool providers

These are tools/capability packs, not policy authorities and not necessarily agent skills.

| Tool | Use | Major rule |
|---|---|---|
| MacWhisper `mw` | Local audio/video transcription | Prefer local transcription; never duplicate it with another Whisper stack unless needed. |
| `yt-dlp` | YouTube/media metadata, subtitles and audio extraction | Captions first; audio + MacWhisper fallback. |
| GStack | Dynamic/authenticated browser work, scraping and codifying repeated browser procedures | Install namespaced; proactive routing and telemetry off; Major remains the router. |
| Native connectors/APIs | GitHub, Google, Figma, mail/calendar etc. | Prefer over browser scraping when available. |
| Major dev-port allocator | Stable local web-server ports across concurrent projects | `major dev port current`; avoid shared 3000/3001 defaults. |
| Major learning candidate queue | Durable process-learning inbox | `major learn capture` after explicit corrections/repeated mistakes once the real task is fixed. |

## Default project / work profiles

### `core`

All Major internal skills. Heavy bodies remain trigger-loaded.

### `knowledge`

`core` with knowledge-work semantics: `source-ingestion` + `knowledge-work` route named sources through native/deterministic tools. `tools-as-code` handles repeated retrieval mechanics. GStack/yt-dlp/MacWhisper remain machine capabilities rather than prompt baggage.

### `web-ui`

`core` + complete Emil bundle + `frontend-design` + `webapp-testing` + `playwright`. Add `vercel-deploy` when the project uses Vercel. Starting a local web preview also triggers `dev-server-management`.

### `exploratory`

`web-ui` + `algorithmic-art` + `exploratory-creative-dev`. Add Rive/Three/R3F/Spline/Remotion as runtime dependencies only if the chosen concept needs them; they are not agent skills by default.

### Specialist triggers

- Start substantive work → `skill-resolver`.
- Explicit correction / repeated mistake / "we fixed this before" → `learning-capture` after the real task is fixed.
- Start/restart/local preview/browser QA/dev server → `dev-server-management`.
- Reusable successful procedure / recurring solved failure → `skillify` after the real task succeeds.
- Repeated deterministic tool/retrieval mechanics → `tools-as-code`.
- Named URL/video/file/source → `source-ingestion`.
- Substantial research/strategy/comparison → `knowledge-work`.
- Figma work → Figma skill set.
- MCP work → `mcp-builder`.
- Skill authoring/evaluation → `skill-creator` plus `skillify` where appropriate.
- Material security work → `security-threat-model`.
- PDFs → `pdf` + `pdf-reporting-qa` as appropriate.
- Deep orchestration → `graph-engineering` only when lean graph engineering is insufficient.

## Explicit recurring exclusions

These may be installed per project when needed, but they are **not** Major recurring defaults:

- `gh-fix-ci` — conflicts with Major's autonomous safe-fix policy; use `ci-recovery`.
- Anthropic `web-artifacts-builder` — optimized for claude.ai artifacts rather than normal deployed product development.
- Anthropic brand-specific skill — Anthropic branding is not a cross-project design standard.
- generic document/spreadsheet/internal-comms skills — outside the engineering harness unless a project requires them.
- duplicate browser/deployment/security skills without a distinct capability.

## Validation contract

The installer must:

1. fetch external sources;
2. record commit SHAs;
3. fail on a selected skill that cannot be found/copied;
4. verify every installed directory contains `SKILL.md`;
5. generate `MAJOR_SKILLS.lock`;
6. never claim a profile is installed when validation fails.

Tool setup must separately verify machine capabilities such as `mw`, `yt-dlp` and GStack rather than pretending that a skill file means the executable exists.
