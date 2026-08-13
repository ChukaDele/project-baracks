# Major platform capability integration audit

Status: first integration slice validated; independent re-review approved
Baseline: `44d00f04fa16276709155b5a26e7997f9b828e71`
Audit date: 2026-08-13

## Bottom line

Major already has the differentiated control plane requested in the brief. It owns project identity, trust, approvals, one-use authority, resource admission, exact-head evidence, independent grading, project-local learning and a hard Lima execution boundary. The main gap is not another runtime. It is a smaller and more reliable capability layer that forces reuse research, settles visual direction before material UI work and proves browser behavior.

The first integration slice therefore changes skills and policy only. It does not add Vercel Workflow, Sandbox, Connect, AI Gateway, Storybook, Motion, inspx or eve to Major's runtime dependencies.

## Current architecture map

| Layer | Current authority | Evidence | Assessment |
| --- | --- | --- | --- |
| Project identity and rerouting | `src/supervisor/state.ts`, `src/context/project-integrity.ts` | Canonical Git identity and worktree-aware tests | Keep |
| Trust and autonomy | `src/supervisor/policy.ts` | Observe, assist, build and unattended transitions; independent grades | Keep |
| Durable task state | SQLite schema plus claim/run/task services | Monotonic attempts, leases, heartbeats, idempotent events and recovery | Keep |
| Capacity and cancellation | `src/supervisor/resources.ts`, `src/supervisor/worker.ts` | Global leases, one Lima worker, heartbeat and stop watcher | Keep |
| Provider routing | `src/routing/router.ts`, provider registry/discovery | Subscription-first provider/model state, paid-use gate and usage evidence | Keep |
| Execution isolation | `ExecutionGateway` to `LimaBackend` | Exact executable, project, release, VM and one-use authority checks | Keep |
| Browser policy | `remote-first-web-development`, `major web preflight` | HTTPS Cloudflare and GitHub target checks | Extend through one browser-verification skill |
| Skills | 38 internal skills plus selected upstream bundles | Immutable resolver, registry/reachability audit and 13 eval fixtures | Consolidate overlapping UI/research skills; expand routing evals |
| Learning | Project and global candidate stores | Sanitization, deduplication, migration, review, promotion and dismissal tests | Keep |
| Independent grading | Supervisor state/policy | Builder/provider separation and fenced completion | Keep |
| Tools and subagents | Provider adapters, browser/Playwright paths, GitHub and deterministic scripts; one coordinator with leased leaf reviewers | Resource guard and worker contracts | Keep the tools; do not add a second agent runtime |
| Connections/OAuth | Provider-specific lifecycle, MCP integration state model and human-blocker handoff | Installed-to-operational checks and credential isolation | Extend only through provider-specific Connect pilots |
| Observability | Runs, events, usage, approvals, retries, duration, evidence, grades and Lima manifests | SQLite and audit tests | Keep normalized local evidence; reuse hosted logs only inside a selected pilot |

## Duplication and reachability audit

| Current capability | Problem | Decision |
| --- | --- | --- |
| `open-source-leverage` | Too narrow. It checks open source but not repository, dependencies, official platform features, commercial tools, cost or an adoption record. | Replace with `research-before-build`. |
| `competitive-product-audit` | Too broad and underspecified for Mobbin/Baymard ethics, evidence and applicability. | Replace with `research-product-patterns`. |
| `design-direction-and-taste` plus `rapid-ui-prototype` | Direction and prototype gates overlap. Neither enforces the required three-direction visible dossier and approval gate. | Merge into `craft-web-interfaces`. |
| `website-design-qa` plus browser parts of other UI skills | Browser evidence is repeated across design, motion and remote-preview instructions. | Replace the general browser contract with `verify-in-browser`; keep motion-specific geometry in `responsive-motion-systems`. |
| Resolver evals | Only 13 of 38 internal skills have positive/negative fixtures. Exact fixture matches can pass without proving useful composition. | Add at least 20 task scenarios for the consolidated slice and keep reachability strict. |
| `lean-graph-engineering` and SQLite workflow state | Already cover bounded local orchestration. A Workflow migration would duplicate proven task claims before a pilot demonstrates value. | Keep current runtime; trial Workflow separately. |
| `mcp-integration-ops` and provider auth | Major already separates installed, configured, authenticated and operational states. | Keep. Evaluate Connect only for supported delegated cloud credentials. |

## Upstream adoption review

| Candidate | Source/version checked | License and maintenance | Decision |
| --- | --- | --- | --- |
| Vercel Web Interface Guidelines | `vercel-labs/web-interface-guidelines` commit `4e799d45c17aec1498c269287a83b9dba22b966b` | MIT; current upstream last pushed 2026-04-06 | Adapt repository-locally. Keep universal rules separate from Vercel brand/copy preferences. Add a read-only diff checker. |
| Rauno interaction principles | Public `rauno.me` article and `raunofreiberg/interfaces` | Public reference principles | Adapt principles. Do not copy product expression. |
| Motion | `motion` 13.1.0 | MIT; React 18/19 | Reuse only when a project already uses it or adoption research selects it. No Major dependency. |
| inspx | `inspx` 0.0.1-alpha.6 | MIT; npm last modified 2022-05-05; repository last pushed 2023-02-01 | Do not adopt. Browser devtools and existing Playwright geometry evidence are better maintained and production-neutral. |
| Storybook | `@storybook/addon-vitest` 10.5.7 | MIT; Vitest 3/4; Vite or Next.js-Vite required | Selective project-level adoption only. Major has no React component surface, so adding it here would be false integration. |
| AI Gateway | AI SDK 7.0.64, `@ai-sdk/gateway` 4.0.51 | Apache-2.0 | Trial only for direct API-model product features. Major's current provider path uses subscription-backed coding CLIs and must not be replaced by paid API routing. |
| Workflow | `workflow` 4.8.2 | Apache-2.0; active | Trial behind a flag after v0.5.1. Compare it with existing SQLite claims using the same bounded task. Do not run two authorities for one task. |
| Sandbox | `@vercel/sandbox` 3.0.0 | Apache-2.0; active; usage-based service | Trial for unfamiliar code only after cost/auth approval. Lima remains the local Product boundary. |
| Connect | Public beta, usage priced by token requests | Vercel service terms; short-lived scoped tokens | Evaluate per provider. Do not assume Recruitly, CV Library or all Google services are supported. |
| eve | 0.34.0, Node 24+, beta | Apache-2.0; active, 813 commits observed | Compatibility spike only. Current Major is Node 22+ and has policy/runtime boundaries eve does not replace. Adoption requires at least 30% generic-code removal and equal controls. |

## Target architecture

```text
Major policy kernel
  project identity | trust | approvals | budget | stop | evidence | learning
                              |
                    tested skill resolver
                              |
  research-before-build -> adoption record -> selected implementation path
                              |
  research-product-patterns -> craft-web-interfaces -> approved design contract
                              |
            test-components (selective) -> verify-in-browser
                              |
     current provider/Lima runtime or a separately approved upstream pilot
                              |
                    independent grader
```

## Keep, merge, replace, trial

| Capability | Decision | Reason |
| --- | --- | --- |
| Policy, project identity, approvals, grading, learning | Keep unchanged | Major-specific value and proven invariants. |
| Reuse research | Replace | Existing skill does not cover the required search order or adoption evidence. |
| Product-pattern research | Replace | Needs one ethical Mobbin/Baymard capability. |
| Visual direction and UI prototype | Merge | One owner must settle direction before code. |
| Browser QA | Merge/extend | One evidence contract should serve product and marketing UI. |
| Component tests | Add selectively | Storybook is useful only for component systems with repeated state risk. |
| Workflow, Sandbox, AI Gateway, Connect, eve | Trial behind flags | Useful upstreams, but no current proof that they improve Major without weakening or duplicating controls. |
| inspx | Do not adopt | Stale alpha package does not beat existing browser tools. |

## Workshop and Product boundary

- Workshop may use isolated pilots, fixtures and greater reversible autonomy.
- Product requires exact project identity, least privilege, durable evidence, independent grading and human approval for consequential external actions.
- A pilot result cannot silently activate a Product dependency.
- No trial may receive client PII or production credentials.
- Major remains foreground by default. No new daemon or unattended authority is added.

## Validation plan

1. Validate skill structure and registry reachability.
2. Run positive and negative resolver fixtures.
3. Run a 20-scenario routing matrix.
4. Unit-test adoption-record validation and upstream-diff behavior where code is added.
5. Use the selected skills on a representative later UI task.
6. Run deployed browser verification for that task.
7. Request an independent exact-head grade before merge.

## Deferred pilots and exit criteria

| Pilot | Start condition | Pass condition | Current blocker |
| --- | --- | --- | --- |
| Workflow | v0.5.1 stable; isolated fixture | Restart/retry/approval/cancel works with less custom code and one authority | Not release-critical; would duplicate current claims now. |
| Sandbox | Explicit cost/auth approval | Unfamiliar code runs with bounded egress, teardown and artifacts | Usage-based service and no approved spend in this task. |
| AI Gateway | A direct model API feature exists | Current catalogue queried; tags, usage, budgets and fallbacks observed | Major currently uses subscription CLIs, not API model calls. |
| Connect | A supported integration is selected | Scoped short-lived token performs one representative operation | Provider support and account linking must be verified individually. |
| eve | Node 24 disposable spike | At least 30% generic code removal with equal policy, isolation and evidence | M1 is closed; ordinary comparative execution is not yet safe. |

`orchestrate-durable-work` was not added as a duplicate skill. Current SQLite claims, `lean-graph-engineering`, resource leases and independent grading already own durable local orchestration. Workflow remains the bounded trial candidate.

`operate-agent-platform` was not added as a broad skill. `mcp-integration-ops`, `cost-control`, provider routing, Lima and exact-head review already split its responsibilities with clearer triggers. AI Gateway, Connect, Sandbox and eve remain explicit adoption-record pilots.

## Validation evidence

- Five replacement skill packages pass the official skill-creator validator.
- Resolver reachability, positive/negative fixtures, the brief's 20 named task classes and additional natural paraphrases pass.
- Adoption records reject missing search layers, placeholder rows, weak evidence and unsupported bespoke builds.
- Design approval records require owner-selected, approved-hybrid or owner-delegated evidence plus three existing project-local moodboards, a reference map and a design contract.
- `scripts/check-web-interface-guidelines-update.sh` matched the live upstream SHA-256 on 2026-08-13.
- Canonical release validation passed with 67 test files and 448 tests, including macOS containment and immutable snapshot smoke.
- Independent adversarial re-review approved the exact current tree with no P0/P1 findings.
- Storybook interaction and browser visual evidence are not applicable to Major itself because this slice adds no React or rendered interface. They remain mandatory when the skills are adopted in a representative UI project.

## Rollback

This slice is reversible by restoring the replaced skill IDs, registry entries and guidance from Git. It changes no database schema, runtime capability flag, provider credential, installed user state or production integration.
