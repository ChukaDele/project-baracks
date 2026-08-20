# DeepSeek Harness strangler receipt

Status: **shadow**. Major is now an upstream-compatible DeepSeek Harness *distribution contract*. Live execution remains the existing Lima + official-CLI/ACP path. Do not delete that path.

## Outcome

Pin DeepSeek Harness, define upstream-shaped dsh profile and bundle source
artifacts, preserve superior Major and GBrain capabilities on the live Major
path, and keep the migration recoverable until real adapters, a representative
project run and independent review pass.

## KEEP

- Major kernel: durable goals, GBrain/learning, skill resolver, Toolsmith, policy/autonomy, evidence, project integrity, subscription routing, kill switch
- Lima `ExecutionBackend` as the default live isolation boundary
- Official Claude/Codex/Antigravity CLI adapters and Cursor native ACP
- Existing install, rollback, workshop session and kill-switch behaviour
- Ruflo as optional subordinate memory/swarm infrastructure, not the agent loop

## ADOPT

- DeepSeek Harness agent-loop, tool registry, session log, headless runner and loopback Web UI, pinned at exact npm versions in `distribution/deepseek-harness/pin.json`

## WRAP

- Official dsh profile/bundle/`cordis.patch.yml` composition so Major can add adapters without forking. The shadow kernel patch is intentionally empty; it must not invent plugin rows before their packages exist.
- dsh approval/session/sandbox *transport* under Major policy and Lima isolation
- Existing subscription-backed providers as model plugins when a later seam proof passes

## SHIM

- Current Lima + CLI/ACP runtime remains the default live path until cutover evidence exists
- Consumer: every supervised worker
- Removal condition: `cutover` phase after attested pin, live dsh conformance, representative project work, and independent review

## DELETE later, not now

- Custom agent-loop and stream parsers only after the successor path is READY
- Duplicate docs/names that describe Major as the only harness, after cutover
- Unpinned `npx @deepseek-ai/dsh` / `latest` / `next` install instructions

## Phases

1. `pin` — exact upstream versions recorded
2. `shadow` — composition and deterministic conformance exist; live traffic still Lima (**current**)
3. `strangle` — selected tasks may opt into pinned dsh inside Lima
4. `cutover` — dsh is default; Lima remains rollback
5. `cleanup` — delete obsolete active paths under `legacy-cleanup`

The upstream release tag and npm package integrities are attested. Cutover and cleanup remain forbidden while `package.json` has no validated dsh dependency, while live DSH conformance has not passed, or while no representative project run exists.

## Unified Mac workstation

One pin, two profiles:

- `major-workstation-web` — loopback dsh Web UI for the owner
- `major-workstation-headless` — Major-driven runs with no extra UI

Both source manifests stack `@deepseek-ai/dsh-base` then the local
`@major/dsh-kernel` bundle. The local dependency is resolvable in the staged
distribution layout. The kernel and profile patches are no-ops during shadow,
so they do not claim a bootable Major adapter. Neither profile auto-starts a
login daemon nor attaches Ruflo globally. Hot workspace policy stays in
`workspace-lifecycle-management`.

## Evidence so far

- Prior-art decision recorded 2026-08-20
- Official tag `dsh-v0.1.0-rc.8` attested at `141eb6fef83422698aef7a981029e843e8161534`; SRI hashes recorded for all four pinned npm packages
- Pin, source profiles, the upstream-shaped no-op kernel seam and `major harness` conformance exist
- Default execution backend remains `LimaBackend`
- Live dsh install, Mac field proof and independent review are **not** claimed
