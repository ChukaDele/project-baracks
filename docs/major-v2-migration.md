# Major 2.0 migration

**Bottom line:** the normal Major 2.0 path is now a headless Major core that uses live provider CLIs and Orca worktrees. The former DeepSeek Harness workstation and Lima worker are compatibility/reference surfaces, not the normal execution path. Ruflo and Langfuse remain optional future integrations. They are not blockers for the current intelligence loop because Major already persists structured run evidence and GBrain-backed meaning locally.

## Target

Major is the standalone cross-project engineering harness for Bredge, client, personal and external projects.

- Major owns human-reviewable policy, project bootstrap, skill catalog and verified reusable learning.
- Ruflo provides the planned orchestration/memory substrate.
- Claude Code, Codex, Google Antigravity and Cursor are worker pools.
- Individual repositories such as JSS are consumers, not owners of Major.

## Decisions already made

- **MVP/speed is the default.** Large briefs become P0 MVP / P1 next / P2 later; P0 is built end to end before broad expansion.
- **Proof-first, not Figma-first.** Use the fastest credible medium for the biggest uncertainty.
- **Visible progress matters.** UI/interaction proof may lead backend via explicit replaceable mocks/contracts.
- **Normal substantive concurrency:** Major derives worker, browser and build ceilings from live resource availability and task economics. The current guard permits up to four workers and six total active resources, but it does not promise that capacity or fill it automatically.
- **Worker pools:** Claude, Codex, Antigravity and Cursor when installed, authenticated and operational. Major routes by task fit, subscription capacity and observed outcomes. Codex is the currently proven host lane in this migration.
- **Skills:** Major internal catalog + complete current Emil bundle for UI + selected Anthropic/OpenAI/graph skills by profile/trigger.
- **Communication:** BLUF + ASD-STE100-inspired simplified technical English across supported worker global/project instructions.
- **Security:** minimum safety floor plus risk-proportional hardening, not enterprise ceremony before proof.
- **Autonomy:** safe reversible work continues until acceptance or a genuine owner-only gate.
- **Legacy:** Git and retained run evidence are the archive. Verified replacements remove obsolete active runtime state while keeping receipts, logs, sessions, stores, credentials and historical explanations.
- **Memory:** GBrain is the durable organizational and project knowledge layer. The local run-insight store keeps compact receipts and performance history. Langfuse/OpenTelemetry can later receive high-volume telemetry without replacing GBrain.

## Completed in this migration layer

- binding Major guidance and precedence;
- provider-neutral project state/roadmap rule;
- reusable verified learning corpus;
- canonical internal/external skill registry;
- profile-based skill installer with lock/validation;
- project bootstrap templates and provider-neutral `AGENTS.md` contract;
- global communication installer for Claude Code, Codex and Antigravity, with Cursor User Rule handoff;
- explicit legacy cleanup protocol and migration receipt;
- static Major validation script wired into CI;
- removal/replacement of stale v1 docs and Surface Talent-specific core examples;
- headless host execution through the Major gateway, with the explicit Lima compatibility boundary retained;
- Orca repository, worktree and terminal integration;
- thin Major UI for intelligence and control;
- structured run receipts, performance history, recurrence detection and evidence thresholds for learning;
- preserved historical DSH receipts, logs, sessions, stores and provider-auth evidence.

## Remaining bounded work

1. Complete human authentication for any provider lane that the owner wants to activate. Major must not copy credentials or claim field proof before that action.
2. Gather comparable multi-worker outcome evidence before promoting a worker, skill or infrastructure change into routing policy.
3. Finish the exact cleanup of any remaining generated DSH/Lima runtime trees after active-consumer and evidence-retention checks.
4. Add a Langfuse/OpenTelemetry exporter only when high-volume telemetry needs an external observability sink. This is an additive seam, not a prerequisite for execution or learning.
5. Rename the repository from the legacy `project-baracks` name to `major` when the repo-control path is available.

## Completion definition

Use `docs/migrations/major-v2-legacy-receipt.md` as the historical migration record and the current readiness evidence in `docs/readiness-model.md`. Normal Major 2.0 execution is ready when the headless path completes a bounded real task with a receipt, the intended provider/Orca boundary is behaviorally proven, and obsolete runtime state is removed only after its replacement and retained evidence are verified.
