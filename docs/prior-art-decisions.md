# Prior-art decisions

Future Major agents must consult this log before rebuilding a capability or adding substantial new infrastructure. Append a record before the build starts, including when the decision is BUILD.

Record format: Capability, Date, Candidates, Decision, Reason, Major-specific layer retained, Rejected alternatives, Evidence.

## 2026-08-17 — compact live Codex usage monitor

- **Capability:** compact live Codex usage for already-authenticated Major accounts
- **Date:** 2026-08-17
- **Candidates:** steipete/CodexBar (menu-bar + `codex app-server` RPC); ad-hoc `codex app-server` scripts; Subrouter quota scoring; Major-native read of persisted provider-auth slots
- **Decision:** BUILD a thin `major provider usage` path. Do not wrap CodexBar or Subrouter.
- **Reason:** CodexBar is a host menu-bar product with cookie/dashboard extras and many providers. Subrouter intercepts HTTP base URLs and stores OAuth tokens outside the vendor store. Major already has two authenticated Codex account slots, a root-owned provider-auth broker, and an isolated `codex-native app-server`. The missing piece is a read-only poll of official `account/read` and `account/rateLimits/read` that does not change routing or credentials (`refreshToken: false`, scratch HOME, no finalize).
- **Major-specific layer retained:** persisted provider/account labels, Lima credential isolation, compact CLI/JSON
- **Rejected alternatives:** wrap CodexBar; wrap Subrouter; scrape chatgpt.com usage; mutate availability/routing from a usage poll
- **Evidence:** official app-server README documents both methods; live quota clients need a short post-`initialized` delay or `account/rateLimits/read` can return empty windows

## 2026-08-17 — subscription-backed coding-agent execution driven by a coordinator

- **Capability:** subscription-backed coding-agent execution driven by a coordinator
- **Date:** 2026-08-17
- **Candidates:** Major native CLI/ACP adapters; Block goose (now hosted by the Agentic AI Foundation under the Linux Foundation, Apache-2.0, ~27k stars) which consumes ACP agents as providers and can route through Claude Code, Codex and Gemini using existing subscriptions; OpenCode (~160k stars, 75+ providers via AI SDK plus models.dev metadata); Subrouter
- **Decision:** KEEP Major's thin adapters and BORROW the ACP pattern, which Major already does
- **Reason:** goose validates the ACP-as-provider approach Major already implements via @agentclientprotocol/sdk 1.3.0 in src/execution/cursor-acp-runtime.ts, and goose is itself removing its direct claude-code/codex/gemini-cli providers in favour of ACP. OpenCode's abstraction is model/API-key routing, a different axis from subscription-backed CLI agents. Adopting goose or OpenCode wholesale would mean adopting a second agent harness and UI on top of Major's coordinator, which adds a layer rather than removing one.
- **Major-specific layer retained:** provider and capability selection, approval policy, billing evidence, durable goals
- **Rejected alternatives:** adopt goose wholesale; adopt OpenCode wholesale; build a second agent harness
- **Evidence:** the reuse matrix in docs/reuse-first-architecture-audit.md already proved Cursor native ACP against community and Harness alternatives; ACP is now broad infrastructure with JetBrains, Google and GitHub support and a public agent registry.

## 2026-08-17 — multi-account subscription quota routing

- **Capability:** multi-account subscription quota routing
- **Date:** 2026-08-17
- **Candidates:** Major native; manaflow-ai/subrouter
- **Decision:** WRAP Subrouter if and when multi-account is genuinely needed. Do not build it.
- **Reason:** Subrouter already scores each account by its most constrained usage window, protects low-headroom accounts, spends quota that resets soonest and refreshes usage on an interval. That is roughly the whole requirement. Its cost is a reverse proxy that replaces outbound credentials and stores OAuth refresh tokens outside the vendor's own store, which needs a security review before adoption.
- **Major-specific layer retained:** routing policy and billing evidence
- **Rejected alternatives:** build a Major-native multi-account router
- **Evidence:** Subrouter README documents openai_base_url and ANTHROPIC_BASE_URL interception with per-account credential substitution
- **Status:** superseded 2026-08-17. Subrouter intercepts HTTP `openai_base_url` / `ANTHROPIC_BASE_URL` and stores OAuth refresh tokens outside the vendor store. That does not wrap Codex CLI `auth.json` subscriptions, and the proxy credential model failed the security bar.

## 2026-08-17 — Codex CLI multi-account subscription quota routing

- **Capability:** secure, quota-aware multi-account Codex subscription routing beneath the existing provider router
- **Date:** 2026-08-17
- **Candidates:** manaflow-ai/subrouter; Major-native account slots under the existing provider-auth broker
- **Decision:** BUILD a thin native account router. Do not WRAP Subrouter for this axis.
- **Reason:** Codex failover was hopping to a different provider (losing vendor session and Major history) because account bookkeeping never selected distinct credentials. Subrouter's HTTP base-URL substitution cannot drive `codex exec` login slots. Major already had per-account capacity keys, exhaustion backoff, and a root-owned provider-auth broker; the missing piece is routing and materializing those slots, plus refusing cross-account session resume.
- **Major-specific layer retained:** provider/class ladder, billing evidence, Lima credential isolation, durable goal history
- **Rejected alternatives:** WRAP Subrouter; a second Lima guest user per account; swapping the default auth.json in place without isolated slots
- **Evidence:** exhausted default Codex + usable `codex#work-b` stays on Codex; vendor session ids resume only on the same account; named credentials live under `provider-auth/<host>/accounts/<label>/` and cannot overwrite default
- **Status:** active, Codex-first. Other providers share the same slot layout but are not required for the P0 proof.

## 2026-08-17 — isolated local runtime for coding agents with provider credential separation

- **Capability:** isolated local runtime for coding agents with provider credential separation
- **Date:** 2026-08-17
- **Candidates:** pinned Lima 2.2 wrapped directly (current); OpenHands Docker agent-server; Docker Sandboxes; MikD1/agent-vm; sylvinus/agent-vm
- **Decision:** KEEP the direct Lima wrap
- **Reason:** this was already audited with disposable proofs. Lima is CNCF Incubating and mature; the agent-vm projects default to host mounts and SSH-agent forwarding, which conflict with Major's no-mount, provider-separated contract; OpenHands' sandbox is a peer implementation of the same idea and switching would be a lateral move with real migration risk while the current path demonstrably works. Docker on macOS also runs inside a VM, so it is not a simpler boundary.
- **Major-specific layer retained:** workspace quarantine, validated delta copy-back, hard descendant termination by VM force-stop
- **Rejected alternatives:** switch to OpenHands Docker agent-server; Docker Sandboxes; adopt MikD1/agent-vm or sylvinus/agent-vm unchanged
- **Evidence:** docs/reuse-first-architecture-audit.md sandbox and Lima rows plus the field gates scripts/validate-cursor-acp-field.mjs and scripts/validate-cli-provider-field.mjs.

## 2026-08-17 — durable cross-project goal, learning and policy persistence

- **Capability:** durable cross-project goal, learning and policy persistence
- **Date:** 2026-08-17
- **Candidates:** Major native (SQLite plus Drizzle); OpenHands; goose; Aider
- **Decision:** BUILD, already built, and KEEP
- **Reason:** this is the exception where no mature prior art covers the requirement. OpenHands and the SWE-agent family have no persistent memory and treat each task as independent with no cross-task learning; their microagent and AGENTS.md mechanisms load static instructions instead. Aider is git-native single-session editing. Persistence is Major's differentiation, so BUILD is correct here under the 70-80 percent heuristic. Storage itself is already adopted rather than built: better-sqlite3 and Drizzle.
- **Major-specific layer retained:** durable cross-project goals, GBrain and learning, policy and autonomy
- **Rejected alternatives:** adopt OpenHands, goose or Aider persistence models
- **Evidence:** the audit of coding-agent scaffolds found no cross-task persistence in OpenHands, SWE-agent, AutoCodeRover, mini-swe-agent or DARS-Agent.

## 2026-08-17 — agent-to-tool transport

- **Capability:** agent-to-tool transport
- **Date:** 2026-08-17
- **Candidates:** provider harness MCP support; official MCP SDKs; Lima MCP Sandbox Interface
- **Decision:** DO NOT BUILD an MCP transport
- **Reason:** unchanged from the existing audit. Providers own tool transport; Major selects and authorises tools.
- **Major-specific layer retained:** tool selection and authorisation
- **Rejected alternatives:** implement a generic Major MCP transport
- **Evidence:** docs/reuse-first-architecture-audit.md MCP row.

## 2026-08-17 — targeted git-native code editing

- **Capability:** targeted git-native code editing
- **Date:** 2026-08-17
- **Candidates:** Aider; the provider CLIs Major already drives
- **Decision:** BUILD nothing; treat Aider as an optional future specialised capability, not a Major subsystem
- **Reason:** Aider remains actively maintained but stable at v0.86.2 and its architect/editor split is a narrower tool than the agent CLIs Major already routes. There is no current requirement it uniquely satisfies.
- **Major-specific layer retained:** provider and capability selection
- **Rejected alternatives:** adopt Aider as a Major subsystem
- **Evidence:** Aider release cadence and feature comparison, 2026.

## 2026-08-17 — reachability-based resource garbage collection

- **Capability:** reachability-based resource garbage collection
- **Date:** 2026-08-17
- **Candidates:** Nix GC roots/generations; Docker/containerd prune; build-cache GC; bespoke Major store
- **Decision:** BORROW the Nix GC-root reachability model
- **Reason:** "everything not reachable from a declared set of roots is garbage" is exactly Major's problem and needs no dependency. Major's roots are installed-release.json, a bounded window of install-history.jsonl generations, execution.json, active resource leases and live supervisor goals.
- **Major-specific layer retained:** classification, retention policy and reporting
- **Rejected alternatives:** adopting Nix or a bespoke store manager
- **Evidence:** Nix treats anything symlinked under gcroots (and profile generations) as a root and deletes all unreachable store paths.

## 2026-08-17 — cleanup UX and usage reporting

- **Capability:** cleanup UX and usage reporting
- **Date:** 2026-08-17
- **Candidates:** docker system df / docker system prune --dry-run; bespoke
- **Decision:** BORROW the docker UX shape
- **Reason:** usage-by-category plus a dry-run that predicts reclaim is the proven, legible pattern.
- **Major-specific layer retained:** Major resource classes and measured df-delta reporting
- **Rejected alternatives:** a bespoke reporting format
- **Evidence:** docker system df prints usage by category; docker system prune --dry-run predicts reclaim without mutating.

## 2026-08-17 — physical (not logical) disk measurement on APFS

- **Capability:** physical (not logical) disk measurement on APFS
- **Date:** 2026-08-17
- **Candidates:** du; df; a thin allocated-blocks helper
- **Decision:** BUILD a thin measurement helper, because no portable tool reports shared-extent-aware per-tree usage
- **Reason:** verified on this machine that `cp -c` clones a 40MB file for 0MB of df-used while `du` still reports 40MB for BOTH copies, so du is an UPPER BOUND once clonefile is used. Therefore: dry-run reports an explicitly-labelled upper-bound estimate from allocated blocks; apply reports the MEASURED df delta. Never present a du sum as actual reclaimed space.
- **Major-specific layer retained:** allocated-blocks upper bound plus measured df-delta after apply
- **Rejected alternatives:** reporting du sums as reclaimed space
- **Evidence:** Earlier in this project a 54GB du reduction produced an 18GiB df reduction; that gap must never be reported as success.

## 2026-08-17 — reclaiming space inside and around Lima instances

- **Capability:** reclaiming space inside and around Lima instances
- **Date:** 2026-08-17
- **Candidates:** limactl delete; limactl prune; fstrim/sparse; bespoke image surgery
- **Decision:** WRAP limactl
- **Reason:** `limactl delete` is the supported instance removal path and `limactl prune` ("Prune garbage objects") handles Lima's own cached objects; fstrim/sparse handling belongs to Lima.
- **Major-specific layer retained:** classification of which Major workers are deletable
- **Rejected alternatives:** any direct manipulation of Lima disk images by Major
- **Evidence:** limactl delete is the documented instance removal path; limactl prune is documented as "Prune garbage objects".

## 2026-08-17 — deduplicating release payloads

- **Capability:** deduplicating release payloads
- **Date:** 2026-08-17
- **Candidates:** APFS clonefile via `cp -c`; pnpm content-addressed store; hardlinks; tar/compress
- **Decision:** ADOPT `cp -c` clonefile for release snapshot payloads, and WRAP `pnpm store prune` for the pnpm store
- **Reason:** verified `cp -c` costs 0MB on this volume; Bun already uses clonefile on macOS for exactly this. node_modules is 45MB of each ~49MB release snapshot, duplicated across 6 releases plus 6 staged-releases.
- **Major-specific layer retained:** clone-or-copy fallback and byte-identity verification
- **Rejected alternatives:** compressing or hardlinking release payloads, because hardlinks break release immutability (a write through one path mutates all) while clones are copy-on-write and preserve integrity
- **Evidence:** verified `cp -c` clones a 40MB file for 0MB of df-used on this volume.

## 2026-08-17 — stale worktree and run-state reclamation

- **Capability:** stale worktree and run-state reclamation
- **Date:** 2026-08-17
- **Candidates:** git worktree prune; a new Major run reaper; extending lima-backend stale-run reconciliation
- **Decision:** WRAP `git worktree prune` and EXTEND Major's existing stale-run reconciliation in src/execution/lima-backend.ts (pendingRunManifests / removeGuestRun / removeGuestTransfer)
- **Reason:** Major already has per-run cleanup; a second parallel mechanism would drift.
- **Major-specific layer retained:** retention windows for host run-state dirs and worktrees
- **Rejected alternatives:** writing a new run reaper
- **Evidence:** lima-backend already reconciles pending run manifests and removes guest run/transfer paths.

## 2026-08-20 — upstream-compatible coding-agent harness distribution

- **Capability:** upstream-compatible, pinned coding-agent harness that Major can distribute on a Mac workstation without losing goals, GBrain, policy or evidence
- **Date:** 2026-08-20
- **Candidates:** DeepSeek Harness (`deepseek-ai/deepseek-harness`, MIT, `@deepseek-ai/dsh`); Vercel AI SDK `HarnessAgent` (already rejected for v0.5.1); keep Major's custom CLI/ACP adapters as the only runtime; goose; OpenCode
- **Decision:** ADOPT DeepSeek Harness as the live agent-loop, tool, session and UI substrate. WRAP it as a Major distribution through the official profile, bundle and patch mechanism. Do not fork upstream. Keep Major as the thin intelligence and policy layer. Use local execution for trusted repositories and Lima only when policy selects higher isolation.
- **Reason:** DeepSeek Harness is the maintained MIT plugin runtime whose explicit contract is that models, tools, sessions, sandboxes, storage, loops, scheduling and UI are replaceable plugins. That is the strangler seam Major needs. AI SDK HarnessAgent was already rejected on orphan-process, approval and inner-sandbox grounds. goose and OpenCode would add a second harness/UI on top of Major. Building another agent loop would duplicate a substantially solved problem. Developer-preview breakage is expected, so the distribution pins exact versions and refuses `latest`, `next` and range resolution.
- **Major-specific layer retained:** durable goals, GBrain and learning, skill resolver, Toolsmith, project trust and policy, independent evidence, subscription routing, kill switch, project-context integrity, and provider-independent environment selection
- **Rejected alternatives:** fork DeepSeek Harness; wrap AI SDK HarnessAgent; adopt goose or OpenCode wholesale; replace GBrain with the DSH session log; make Lima the permanent provider runtime; resolve unpinned `@deepseek-ai` dist-tags
- **Evidence:** the official repository describes profile and plugin composition and warns that the developer preview will have compatibility-breaking changes. npm published `@deepseek-ai/dsh@0.1.0-rc.8` on 2026-08-19 with integrity `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`. Official tag `dsh-v0.1.0-rc.8` resolves to commit `141eb6fef83422698aef7a981029e843e8161534`.

### Live-runtime cutover

- **Decision:** ADOPT the pinned DSH provider adapters as the default live route; WRAP only goal admission, Major provider/model/account routing, environment selection and result checkpointing. Provider choice remains Major control-plane policy, orthogonal to the `local` or `lima` execution environment.
- **Boundary:** unset, empty or explicit `local` selects native DSH local execution. Explicit `lima` selects the same Major-routed provider through the DSH Lima environment. Explicit `legacy` selects the old `major run` and `LimaBackend` compatibility path. Hosts without live DSH adapters fail closed.
- **Machine receipt:** `distribution/deepseek-harness/runtime-checkpoint.json`.

## 2026-08-20 — future Computer execution environment donor register

- **Capability:** later browser and human-control execution environment, independent from provider choice
- **Date:** 2026-08-20
- **Candidates:** OpenBot desktop/workspace concepts; OpenBrowser profile, handoff, telemetry and audit patterns; OpenDevBrowser accessibility snapshots, screencast and fail-closed ref patterns; existing DSH browser tools
- **Decision:** BORROW only clean MIT-licensed implementation patterns for a later `Computer` environment. Do not install OpenBot or add a second runtime in P0.
- **Reusable donor surface:** isolated Chromium profile; workspace; live screen/screencast; accessibility snapshot; human take-control and return-control; browser/file action gateway; audit-before-action; fail-closed policy; secret entry outside the transcript.
- **Rejected alternatives:** CopilotKit Intelligence as canonical memory; a second Postgres runtime; the LangGraph example stack; a second canonical agent platform. GBrain remains canonical learning and memory.
- **Evidence:** OpenBot desktop exposes shared CLI/desktop configuration and workspaces (`https://github.com/next-open-ai/openbot`). OpenBrowser documents isolated profiles, human auth handoff, telemetry and audits (`https://github.com/floomhq/openbrowser`). OpenDevBrowser documents accessibility snapshots, screencast, persistent profiles and explicit secret-entry boundaries (`https://github.com/freshtechbro/opendevbrowser`).

## 2026-08-20 — Mac application experience for the pinned DSH workstation

- **Capability:** smallest owner-facing Mac application that starts the already-pinned Major DSH web workstation for one real project
- **Date:** 2026-08-20
- **Candidates:** official `dsh --profile` web runner (`@deepseek-ai/dsh`, loopback `127.0.0.1:3080`, `--no-open`); Chromium/Chrome `--app` windows; Electron; Tauri; a login LaunchAgent or unattended daemon; community DeepSeekHarnessGreen packaged launchers
- **Decision:** WRAP the existing `major-workstation-web` profile and official DSH web boot. BORROW Chrome `--app` for one owner window. BUILD only a reversible installer-managed `Major.app` stub plus bash launcher. Do not add Electron, Tauri, a duplicate service, or an unattended login agent.
- **Reason:** DSH already owns the agent loop, loopback Web UI, SIGINT/SIGTERM drain, and in-page directory picker. Chrome app-mode is the maintained thin window for a local URL without a second desktop runtime. DeepSeekHarnessGreen is a third-party packaged fork. Electron/Tauri would duplicate the web substrate. A LaunchAgent would violate the no-daemon workstation contract. The Major-specific remainder is install/rollback, a single-instance lock, logs under the DSH home, and preserving the live Lima + `major` CLI path.
- **Major-specific layer retained:** pin installer, isolated DSH home, loopback-only bind, duplicate prevention, clean stop, rollback of the `.app` without touching the user checkout or live Major backend
- **Rejected alternatives:** Electron; Tauri; login LaunchAgent; wrapping DeepSeekHarnessGreen; replacing DSH web with a custom UI; binding `0.0.0.0` (official CLI rejects it)
- **Evidence:** official CLI reference: `dsh --profile <name>` boots `$DSH_HOME/profiles/<name>`, web args are `--host`/`--port`/`--no-open`/`--trusted-host`, default `http://127.0.0.1:3080`, invoking directory is the default workspace, first SIGTERM drains then exits 0. Chrome `--app=URL` opens a dedicated window. The existing web profile already disables native directory-picker-auto on darwin loopback.

## 2026-08-20 — `/major` command transcript rendering

- **Capability:** durably render the complete human-entered `/major` command before its result after a DSH restart
- **Candidates:** DSH conversation-event Definition plus upstream `command-input` view renderer; a Major session store; a Major React component or CSS layer
- **Decision:** BORROW the upstream conversation-event projection, `command-input` renderer, session log, and trajectory target. Ship one prebuilt, self-contained lazy-CJS `@major/dsh-kernel` client factory; project Major's durable command lifecycle into the upstream chat and trajectory targets.
- **Reason:** DSH already persists and replays `command/run`, `command/done`, and turn markers and owns their UI. Major needs only an empty completed turn for rc.8 restart visibility, its command input at the correct sequence anchor, and a tool-shaped contribution containing the complete result. A second session store, result renderer, trajectory implementation, React tree, or stylesheet would duplicate upstream infrastructure and could diverge after restart.
- **Major-specific layer retained:** recognition and reconstruction of the human-entered `/major` input; the existing log-only execution semantics remain unchanged
- **Rejected alternatives:** raw ESM browser entrypoints; a split runtime-loaded `command-input.js`; a Major session store; bespoke command/result UI or CSS
- **Evidence:** the pinned DSH client-module contract registers browser bundles with `window.__ModuleLoader__.load({ id, factory })`; factory VM tests materialize `@major/dsh-kernel`, build the upstream `command-input` node and native trajectory tool contribution from replayed events, and the server command test records only a closed empty turn around the log-only command handler—no user, assistant, step, or model-dispatch event.
