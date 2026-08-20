# Major 2.0 migration

**Bottom line:** the Major 2.0 policy, skills, bootstrap, communication standard and reusable knowledge are being made canonical in this branch. The migration is **not runtime-complete** until Ruflo-backed execution replaces the old disabled Major v1 execution path and the remaining v1 code is deleted.

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
- **Normal substantive concurrency:** 3–4 useful workers, with a hard global ceiling of 6 active resources across the full task tree.
- **Worker pools:** Claude, Codex, Antigravity and Cursor; route by task fit, subscription capacity and observed outcomes.
- **Skills:** Major internal catalog + complete current Emil bundle for UI + selected Anthropic/OpenAI/graph skills by profile/trigger.
- **Communication:** BLUF + ASD-STE100-inspired simplified technical English across supported worker global/project instructions.
- **Security:** minimum safety floor plus risk-proportional hardening, not enterprise ceremony before proof.
- **Autonomy:** safe reversible work continues until acceptance or a genuine owner-only gate.
- **Legacy:** Git is the archive; verified replacements delete obsolete active code/docs/config/names.
- **Memory:** Major Git/Markdown is human-reviewable truth; Ruflo/AgentDB is a derived retrieval/index layer; project-sensitive knowledge stays isolated.

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
- removal/replacement of stale v1 docs and Surface Talent-specific core examples.

## Remaining runtime work

1. Attest the DeepSeek Harness pin (git commit + npm integrity) and install that exact version inside Lima; keep live traffic on the current CLI/ACP path until that shadow run is green (`docs/migrations/deepseek-harness-strangler.md`).
2. Integrate Ruflo as optional orchestration/memory substrate. It is not the agent loop; DeepSeek Harness is.
3. Implement/verify live worker adapters for Claude Code, Codex, Antigravity and Cursor, including as dsh model plugins when subscription auth is proved.
4. Enable bounded real execution, adaptive worktrees and continue-until loops.
5. Import/index approved Major/project memories with namespace boundaries.
6. Run the global communication/style installer on the development Mac and configure Cursor global User Rules.
7. Bootstrap and execute a real managed project as the harness smoke test (JSS assist pilot).
8. Verify provider/rate-limit failover and objective completion evidence.
9. Delete old v1 disabled execution gates, obsolete tests/schema/docs/flags that no longer serve the target runtime — only after successor proof.
10. Run the stale-reference, CI and end-to-end cleanup gate.
11. Rename the repository from the legacy `project-baracks` name to `major` when the repo-control path is available.

## Completion definition

Use `docs/migrations/major-v2-legacy-receipt.md` as the migration gate. Major 2.0 is ready only when the new runtime completes a real bounded multi-agent task with evidence **and** the obsolete v1 execution path has been removed.
