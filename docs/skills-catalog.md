# Major skill catalog

This is the human-reviewable catalog for the recurring Major skill library.

**Policy:** Major can own a broad library, but project/worker context receives only the relevant profile and triggered specialist skills. External skills are subordinate to active Major guidance.

## Major internal skills — 40

These are canonical Major-owned skills.

| Skill | Use |
|---|---|
| `project-start` | Start a new/existing repo from outcome, current state and fastest proof. |
| `project-context-integrity` | Confirm the requested project/repo before edits; reroute an unambiguous wrong-workspace task instead of patching the wrong repo. |
| `workspace-lifecycle-management` | Manage HOT/WARM/COLD local project lifecycle, safe clone parking/deletion, storage pressure, large assets and local-vs-cloud development without losing project truth. |
| `mvp-speed-prioritisation` | Reduce large briefs to P0 MVP / P1 / P2 and build P0 end to end. |
| `legacy-cleanup` | Finish migrations with one canonical path and remove stale active artefacts. |
| `major-self-maintenance` | Keep Major main green; make self-changes atomically through branch/PR/full gate/independent review where consequential. |
| `skill-resolver` | Select only the small set of task-relevant skills; audit overlap/reachability. |
| `learning-capture` | Harvest explicit corrections/repeated mistakes after fixing the real task; classify project/global/policy/skill/memory. |
| `skillify` | Turn a successful reusable procedure into a tested skill pack after the real task works. |
| `tools-as-code` | Compose repeated deterministic retrieval/filter/dedupe/rank/transform mechanics with short temporary code. |
| `design-direction-and-taste` | Canonical art-direction layer: design read, surface mode, preserve-vs-redesign, variance/motion/density, anti-default discipline and bounded critique. |
| `remote-first-web-development` | Require GitHub plus a Cloudflare preview for browser work and block local browser targets. |
| `website-design-qa` | Canonical website/landing-page visual, responsive, browser, launch, SEO, accessibility and production QA doctrine. |
| `responsive-motion-systems` | Responsive GSAP/ScrollTrigger/sticky/pinned/Three.js geometry, lifecycle, handoff and zoom-robustness doctrine. |
| `human-blocker-orchestration` | Surface auth/OAuth/2FA/CAPTCHA/payment/irreversible human-only actions and keep independent work moving. |
| `dev-server-management` | Coordinate an explicitly approved local exception only. |
| `mcp-integration-ops` | Diagnose and prove MCP/connector/plugin integrations across installed→configured→exposed→authenticated→permissioned→operational→integrated states. |
| `analytics-with-shaper` | SQL-first Taleshape Shaper dashboards, operational analytics, reporting, alerts and privacy-safe Major telemetry exports. |
| `gaussian-splatting-spatial-reconstruction` | Consent-gated 3D Gaussian Splatting reconstruction, spatial visualisation and novel-view rendering. |
| `source-ingestion` | Retrieve named primary sources with the right connector/CLI/browser/local tool before analysis. |
| `knowledge-work` | Research/strategy/synthesis with minimum credible evidence, independent angles and skeptic review where justified. |
| `competitive-product-audit` | Learn direct/adjacent product patterns before reinventing workflows. |
| `open-source-leverage` | Reuse/adapt/wrap maintained systems before commodity rebuilds. |
| `prior-art-discovery` | Required gate before substantial new infrastructure: search existing Major/provider/MCP/OSS options, prefer ADOPT/WRAP/BORROW over BUILD, and record the decision. |
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
| `exploratory-creative-dev` | Awwwards/FWA/heavy-motion/immersive execution after art direction is settled. |

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

GBrain can now accept one bounded successful workflow in the final worker report. One-offs remain project-local candidates. Semantically recurring, distinct tasks may synthesize and promote one Agent Skills compatible pack after deterministic validation. Existing-skill overlap is held for an update instead of creating a duplicate. Active generated skills route through the same resolver, and outcome evidence drives version review or deprecation. Direct automatic global promotion remains forbidden.

Rules prevent. Skills institutionalize. Memory reminds.

## Workspace lifecycle policy

Major keeps a verified machine-specific workspace memory in `memory/verified/developer-workspace-lifecycle.md` and retrieves it only for project lifecycle/storage decisions.

Key model:

- Mac = active workspace;
- GitHub = canonical source **after** local commit/push/non-Git state verification;
- deployment providers = runtime;
- cloud/external storage = large assets/archives/backups;
- HOT/WARM/COLD project states keep only genuinely active repos fully hydrated locally;
- do not create duplicate project clones when the expected path is missing;
- do not delete a clone merely because a GitHub repo exists; verify local-only commits, untracked/ignored files and non-Git state first;
- prefer pnpm for new compatible Node projects, but do not churn healthy active projects just to migrate package managers;
- disk-headroom thresholds are machine-specific operational guidance, not universal developer policy.

## Design-direction source policy

Major reviewed two external design systems and **did not install either wholesale**:

- `pbakaus/impeccable` — useful surface modes, preserve-vs-redesign discipline, design-specificity critique, deterministic detector philosophy and bounded finish passes.
- `Leonxlnx/taste-skill` — useful brief inference, Design Read, variance/motion/density calibration and anti-default discipline; current v2 is explicitly experimental upstream.

The non-duplicative judgment is distilled into `design-direction-and-taste`, with exact source commits and accepted/rejected ideas recorded in `memory/verified/design-direction-taste-synthesis.md`.

Reason: loading Impeccable, Taste Skill, Anthropic frontend-design, Emil, Major website QA and Major motion doctrine as simultaneous generic taste authorities would create contradictory defaults and context bloat. One canonical Major art-direction layer owns taste; specialist skills keep separate responsibilities.

The Impeccable deterministic detector remains a **candidate subordinate tool**, not a global hook. Its local live-server/browser flow conflicts with Major's remote-first web policy; source-file detector use can be evaluated separately before adoption.

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
| `frontend-design` | UI/Web | Strong frontend implementation/design guidance beneath Major's canonical art-direction layer. |
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

## Live vendor skill sources

Major keeps nine current Vercel capabilities as a metadata-only live source. The catalog records official URLs, revision, per-skill version where available, freshness, license/provenance status, client support, resolver domains and bounded section references. It does not copy vendor skill bodies into the Major bundle.

| Source | Coverage | Operational path |
|---|---|---|
| `vercel-labs/agent-skills` | Vercel optimization, React/Next.js performance, web and writing guidelines, React Native, view transitions, composition patterns, deployment and CLI/token guidance | Resolver selects a relevant section reference. `major skill vendor --task "..." --refresh` explicitly retrieves only that section and caches it within the freshness window. |

Live vendor guidance is subordinate to Major policy. A vendor reference does not grant deployment, claim, merge or production authority. When a live source is stale, degraded or unavailable, Major exposes that state and keeps the official reference visible rather than silently treating a frozen copy as current.

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
| Major remote-preview preflight | Block local or non-Cloudflare browser targets | `major web preflight` before browser work. |
| Major project context guard | Prevent edits in the wrong repo and provide the canonical target path | `major project guard <target>` / `major project locate <target>`. |
| Major learning candidate queue | Durable process-learning inbox | `major learn capture` after explicit corrections/repeated mistakes once the real task is fixed. |

## Default project / work profiles

### `core`

All Major internal skills. Heavy bodies remain trigger-loaded.

### `knowledge`

`core` with knowledge-work semantics: `source-ingestion` + `knowledge-work` route named sources through native/deterministic tools. `tools-as-code` handles repeated retrieval mechanics. GStack/yt-dlp/MacWhisper remain machine capabilities rather than prompt baggage.

### `web-ui`

`core` + `design-direction-and-taste` when art direction is material + `remote-first-web-development` + `website-design-qa` + `responsive-motion-systems` when motion applies + complete Emil bundle + `frontend-design` + `webapp-testing` + `playwright`. GitHub plus a Cloudflare preview must exist before browser work unless the owner explicitly grants a local exception.

### `exploratory`

`web-ui` + `algorithmic-art` + `exploratory-creative-dev`. Art direction remains owned by `design-direction-and-taste`; `exploratory-creative-dev` executes the chosen world. Add Rive/Three/R3F/Spline/Remotion as runtime dependencies only if the concept needs them.

### Specialist triggers

- Start substantive work → `skill-resolver` plus relevant project learnings.
- Named/clearly implied project differs from current workspace → `project-context-integrity` before edits.
- Project create/clone/locate/move/park/delete/archive/storage-pressure/large-asset/local-vs-cloud decision → `workspace-lifecycle-management`.
- Major/project-baracks self-change → `major-self-maintenance`.
- Explicit correction / repeated mistake / "we fixed this before" → `learning-capture` after the real task is fixed.
- Substantial UI/website creation, redesign, new visual identity, "generic AI", "too safe", "too loud" → `design-direction-and-taste`.
- Web UI implementation/browser/launch QA → `remote-first-web-development` + `website-design-qa`.
- GSAP/ScrollTrigger/sticky/pinned/Three.js/viewport motion → add `responsive-motion-systems`.
- Explicit owner-approved local exception → `dev-server-management`.
- MCP/connector/plugin setup/reconnect/tool exposure/auth/permission failure → `mcp-integration-ops`.
- Taleshape Shaper dashboards or privacy-safe SQL analytics over Major telemetry → `analytics-with-shaper`.
- 3D Gaussian Splatting, COLMAP-to-splat reconstruction or novel-view rendering → `gaussian-splatting-spatial-reconstruction`.
- Reusable successful procedure / recurring solved failure → `skillify` after the real task succeeds.
- Repeated deterministic tool/retrieval mechanics → `tools-as-code`.
- Named URL/video/file/source → `source-ingestion`.
- Substantial research/strategy/comparison → `knowledge-work`.
- Figma work → Figma skill set.
- MCP server authoring → `mcp-builder`.
- Skill authoring/evaluation → `skill-creator` plus `skillify` where appropriate.
- Material security work → `security-threat-model`.
- PDFs → `pdf` + `pdf-reporting-qa` as appropriate.
- Deep orchestration → `graph-engineering` only when lean graph engineering is insufficient.

## Explicit recurring exclusions

These may be installed per project when needed, but they are **not** Major recurring defaults:

- raw `impeccable` as a second generic design authority — useful source/tool candidate, but overlaps with Major design/QA/motion and its live-server hook conflicts with remote-first policy;
- raw `design-taste-frontend` / `gpt-taste` as a second generic taste authority — v2 is experimental and several blanket defaults conflict with brief-first/project-first design;
- `gh-fix-ci` — conflicts with Major's autonomous safe-fix policy; use `ci-recovery`;
- Anthropic `web-artifacts-builder` — optimized for claude.ai artifacts rather than normal deployed product development;
- Anthropic brand-specific skill — Anthropic branding is not a cross-project design standard;
- generic document/spreadsheet/internal-comms skills — outside the engineering harness unless a project requires them;
- duplicate browser/deployment/security skills without a distinct capability.

## Validation contract

The installer must:

1. fetch external sources;
2. record commit SHAs;
3. fail on a selected skill that cannot be found/copied;
4. verify every installed directory contains `SKILL.md`;
5. generate `MAJOR_SKILLS.lock`;
6. sync canonical internal skills globally so a newly promoted cross-project skill is reachable by fresh sessions without re-bootstrapping every existing repo;
7. never claim a profile is installed when validation fails.

Tool setup must separately verify machine capabilities such as `mw`, `yt-dlp` and GStack rather than pretending that a skill file means the executable exists.
