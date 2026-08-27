# DeepSeek Harness cutover receipt

Status: **normal path migrated**. The headless Major core owns routing, policy,
goals, accounts, skills, evaluation, run receipts and GBrain learning. Orca is
the primary operational substrate. DeepSeek Harness remains historical and
explicit compatibility/reference infrastructure. It is not the normal worker
runtime.

## Outcome

Run trusted repository mutation through official provider CLIs under Major's
host containment boundary, with Orca-owned worktrees for operational isolation.
Keep provider choice independent from the execution boundary. Preserve the
Major intelligence path and all historical DSH/Lima receipts. Lima remains an
explicit compatibility option while its active consumers are audited. No DSH
runtime is selected by the normal path.

## KEEP

- Major kernel: durable goals, GBrain/learning, skill resolver, Toolsmith, policy/autonomy, evidence, project integrity, subscription routing, kill switch
- Lima `ExecutionBackend` as an optional isolation and compatibility boundary
- Official Claude/Codex/Antigravity CLI adapters and Cursor native ACP
- Existing install, rollback, workshop session and kill-switch behaviour
- Ruflo as optional subordinate memory/swarm infrastructure, not the agent loop

## ADOPT

- DeepSeek Harness agent-loop, tool registry, session log, headless runner and loopback Web UI, pinned at exact npm versions in `distribution/deepseek-harness/pin.json`, as retained historical/reference evidence only

## WRAP

- Official dsh profile/bundle/`cordis.patch.yml` composition so Major can add adapters without forking. The kernel patch mounts `@major/dsh-kernel` after upstream bundles; it must not become the live worker backend.
- DSH provider/environment transport under Major routing and policy
- Existing subscription-backed providers through their official DSH adapters

## SHIM

- `major execution select --path lima` selects the explicit Lima compatibility path.
- The old `MAJOR_DSH_EXECUTION_ENVIRONMENT` switches are retained only for historical compatibility tooling.
- Removal condition: active consumers reach zero after the host path, Orca operations and durable receipts remain green.

## DELETE later, not now

- Custom agent-loop and stream parsers only after the successor path is READY
- Duplicate docs/names that describe Major as the only harness, after cutover
- Unpinned `npx @deepseek-ai/dsh` / `latest` / `next` install instructions

## Phases

1. `pin` — exact upstream versions recorded
2. `shadow` — composition and deterministic conformance existed
3. `strangle` — selected tasks may opt into pinned dsh inside Lima
4. `cutover` — DSH was default; local was the default environment; Lima remained rollback (**historical**)
5. `headless-cutover` — Major host CLI path is default; Orca owns operations; DSH/Lima are explicit compatibility (**current**)
6. `cleanup` — remove obsolete active paths under `legacy-cleanup` after live evidence and ownership checks

The upstream release tag and npm package integrities are attested. The exact pin
is installed outside `package.json`. Native local and Lima environment proofs
passed before default cutover.

## Historical unified Mac workstation

One pin, two profiles:

- `major-workstation-web` — loopback dsh Web UI for the owner. Its
  `cordis.patch.yml` disables `@deepseek-ai/dsh-host-directory-picker-auto`
  (which selects native on darwin loopback) and mounts the upstream browse host
  plus client UI so workspace creation stays in-page.
- `major-workstation-headless` — Major-driven runs with no extra UI

Both source manifests stack `@deepseek-ai/dsh-base`, the official Codex and
Claude Code providers, then the local `@major/dsh-kernel` bundle. One shared
runtime owns the exact attested DSH packages and React 18.3.1 peers. Both
installer-owned profiles share that dependency closure and the local kernel
through symlinks. The installer proves both composed profiles with
`--dump-config`, then stages a reversible, installer-marked `Major.app` under
`${MAJOR_APP_DIR:-$HOME/Applications}` with a pointer back to the DSH home.
It refuses to replace or remove an unmarked bundle. The launcher starts one loopback-only pinned web process, refuses a
second live instance, opens a Chrome `--app` window for a real project
directory, logs under the DSH home, and stops on SIGTERM. It does not install
Electron, Tauri, a login daemon, or rewrite the live `major` PATH. Neither
profile auto-starts a login daemon nor attaches Ruflo globally. Hot workspace
policy stays in `workspace-lifecycle-management`.

## Evidence so far

- Prior-art decision recorded 2026-08-20
- Official tag `dsh-v0.1.0-rc.8` attested at `141eb6fef83422698aef7a981029e843e8161534`; SRI hashes recorded for six DSH packages and two React runtime peers
- Pin, source profiles, the upstream-shaped Major command kernel and `major harness` conformance exist
- `major harness install-plan` and `scripts/install-deepseek-harness-pin.sh` stage the attested pin into an isolated `$MAJOR_HOME/dsh-harness` without changing the live backend
- Installer disk preflight matches Major's 10%/20GiB block before npm or Lima cycling
- `/major` admits with `MAJOR_SESSION_HOST`, asks Major for provider/model/account routing, and invokes the selected native DSH adapter
- `major harness workstation-app` records the reversible `Major.app` + Chrome app-mode launcher contract
- `pnpm validate:dsh` runs the deterministic source gate (validate-major, harness tests, conformance, install dry-run)
- Isolated-home tests stage/remove `Major.app` and prove single-instance start/stop with fakes; they are not a Mac field proof
- The former default execution backend was DSH and the former default environment was local.
- The same Major-selected Codex adapter passed a separate Lima environment proof.
- Both proofs included a real file mutation, tests, an independent native Claude review, trajectory persistence and restart/resume.
- Canonical installation and exact-main release gates remain separate checks.

## Current headless cutover evidence

The current cutover is deliberately bounded. It must prove the following on the
new path before cleanup removes any owned legacy process or artifact:

- `major execution status` reports the host Seatbelt boundary and `host` is the selected path;
- `major provider probe --provider codex` observes the supported host CLI without copying credentials;
- a normal Major run records a compact `major.run-insight.v1` receipt with useful-work and infrastructure timing;
- the receipt/report and project context are available after a Major restart;
- Orca resolves the canonical repository and worktrees without becoming a second memory or policy store;
- the thin Major UI reads the same durable state without starting a worker;
- DSH/Lima cleanup inventory preserves receipts, project brains, skills, incidents, outcomes and validated learnings.

The historical DSH receipts and validation leases are evidence of what the old
path did. They are not permission to keep the old path active.
