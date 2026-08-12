# Major global worker rules

Apply these defaults across projects unless a project/user instruction is more specific.

## Major is the default control plane

- Every substantive engineering or knowledge-work session is Major-managed by default.
- Major's canonical local CLI is `$HOME/.local/bin/major`.
- At session start, attach to Major. Claude does this through a SessionStart hook. In Codex, Cursor and Antigravity, before substantive work run `$HOME/.local/bin/major session attach --cwd "$PWD" --host <codex|cursor|antigravity>` if the session has not already shown `MAJOR CONTROL PLANE: ACTIVE`.
- Do not make the user remember or repeatedly invoke Major.
- **Presence is not execution authority.** Read the project policy plus explicit owner direction before delegating or starting background work.
- The owner may explicitly fast-track a project into `build` with `--owner-approved`; this bypasses shadow/assist ceremony for foreground work but does not grant unattended authority.
- Client/candidate/PII projects may run in owner-approved `client/build`, but their data must remain project-local and must never flow into global Major/GBrain/Ruflo memory.
- If an active Major goal exists, preserve the durable outcome across the session rather than treating the latest message as an isolated micro-task.
- Use `$HOME/.local/bin/major status <project>` before declaring a project complete or blocked.

## Trust levels

- `observe`: no Major worker execution. When deliberately using the evidence-first ramp, create a concise **MAJOR SHADOW PLAN** and let a human/gstack driver perform the work. **Three consecutive passing shadow grades** may earn `assist`.
- `assist`: visible foreground pilot, maximum 1 worker and maximum 30 minutes per coordinator run.
- `build`: normal foreground working mode, maximum 1 worker and maximum 120 minutes per coordinator run. It may be reached either through evidence-based promotion or explicit owner approval.
- `unattended`: maximum 1 worker with background continuation. This still requires a representative build-mode result plus a fresh independent execution grade; owner-approved build does not silently grant unattended execution.

For owner-approved build projects, do not re-introduce shadow runs, repeated permission prompts, or ceremonial review loops that block ordinary reversible engineering.

## Global resource guard

- The hard ceiling is 6 active resources across the full task tree. Parent agents, child agents, nested subagents, QA workers, browser workers and build workers share this one budget. The preferred operating range is 3–4 active resources.
- Subagent depth is 1 by default. Review and QA workers are leaves. They do not delegate unless Major has granted a parent-linked worker lease and the request remains within depth 1.
- Before starting a worker, browser or build, acquire a Major lease with `major resource acquire --kind <worker|browser|build> --owner <stable-owner> --project <project>`. Pass `--parent <lease-id>` for child workers. Release it immediately after the work with `major resource release --lease <lease-id>`.
- A queued result is not permission to start. Wait until Major promotes the request. Six occupied slots means further work queues.
- Browser budget: at most one shared visible browser plus one headless browser context. Reuse contexts and close each viewport/page set promptly.
- Build budget: one production build at a time. Build once per relevant commit. Reviewers inspect the same immutable remote preview.
- Major admission checks the shared resource ledger and memory availability. Below the memory soft floor, new work queues instead of increasing pressure.
- Use `major resource status` for lightweight telemetry: workers, browsers, builds, total active, queued and memory availability.
- QA runs are serialized through the single v0.5.1 worker: review, consolidate and repair, then run the next reviewer and final verifier.

## Communication

- Use BLUF: result/decision/action first.
- Use short, direct, active sentences and simple technical English.
- Keep terminology consistent. Explain unavoidable jargon once.
- Separate fact, assumption, risk, recommendation and next action when mixing them could mislead.
- Do not bury the recommendation in background or corporate filler.

## Speed / MVP

- MVP is the default. Reduce broad feature lists to the smallest end-to-end P0 that proves the core value loop; build P1/P2 only after P0 is demonstrably working.
- Prove the riskiest assumption in the fastest credible medium. Figma is optional, not a required stage.
- Prefer visible/testable progress and complete vertical slices over fractional horizontal foundations.
- UI may lead backend using clearly labelled, replaceable fixtures/contracts when that accelerates proof.
- Do not build more harness infrastructure when the current product task can be solved directly.

## Code simplicity

- Default to the **smallest correct modular implementation** that achieves the required outcome.
- Give each module/function one clear responsibility and keep inputs/outputs explicit.
- Keep side effects at boundaries; keep business rules independent of UI, database and provider SDKs where practical.
- Do not add abstraction for hypothetical future needs, a second implementation that does not exist, or ceremony that does not improve the current outcome.
- Reuse one canonical implementation instead of keeping duplicate code paths that can drift.
- Before merge, simplify any code that can lose moving parts without losing clarity, correctness, testability or replaceability.
- Load `simple-modular-code` for architecture and implementation work when more detailed guidance is useful.

## Skill-first execution

- Resolve the smallest relevant set of installed skills before inventing a new workflow.
- Installed does not mean loaded; avoid irrelevant or overlapping skills.
- Prefer markdown judgment + minimal deterministic code over permanent hard-coded orchestration.
- If a successful novel procedure is likely to recur, use `skillify` after the real task succeeds.
- Do not skillify trivial one-offs or pause an active P0 to build tooling.
- **An explicit user correction or "we already fixed this" statement is a learning event.** Fix the current task first, then capture it project-locally with `major learn capture`. Global promotion is a separate reviewed action that requires sanitized content and evidence. Do not rely on chat memory alone.

## Remote-first web development

- For every web project, use GitHub plus a Cloudflare preview before any browser preview, visual QA or acceptance testing. Load `remote-first-web-development` before UI work.
- Local compilation, unit tests, linting and asset processing are allowed. Persistent local servers and local browser navigation are denied unless the owner explicitly opts in for that specific project.
- Never open `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`, `.local` or an arbitrary local port for application preview, development, visual QA, E2E targets or user-facing links.
- A trusted CLI may temporarily use a loopback OAuth callback, such as Wrangler's authentication callback. This exception applies only to the provider authentication handoff. It does not permit serving, previewing, testing or showing the application on a local URL.
- Before any browser action, run `major web preflight --preview-url <Cloudflare URL> --github-url <GitHub URL> --production-branch main`. The command rejects local, non-HTTPS and non-Cloudflare browser targets.
- The required order is repository, GitHub remote, Cloudflare project, remote preview URL, browser QA, then promotion through `main`.
- Generic skills that start `npm run dev` or open local URLs are lower authority. Replace their preview step with a Cloudflare preview deployment.

## Human-blocker orchestration

- Load `human-blocker-orchestration` whenever authentication, OAuth, consent, 2FA, CAPTCHA, payment or an irreversible account or domain decision can block work.
- Use the Codex in-app browser for a human-only web action. Verify its active visible tab and rendered page before claiming the owner can see it. If the visible browser differs from the controlled browser, report `BROWSER ATTACHMENT FAILURE` and repair it.
- Send a native `Major — Action required` notification with the project name and specific required action. Also post `🔴 HUMAN ACTION REQUIRED — <specific action>` in the task.
- Mark only the dependent branch as `PARTIALLY BLOCKED` when independent work remains. Continue that work. Use `FULLY BLOCKED` only when nothing useful can proceed. Poll the visible browser and enter `RESUMING` when authentication resolves; never require a generic "done" message when browser state proves completion.

## Tools as Code

Use short temporary code when repeated deterministic tool calls would otherwise consume many model turns.

Good cases include retrieve/fan-out/filter/dedupe/rank, batch transformations, repeated validation and source normalization.

- Prefer native connectors/APIs/CLIs as primitives.
- Use generated code for mechanics; use the model for judgment/synthesis.
- Keep provenance.
- Do not use code to bypass filesystem, credential, client-data, paid-spend or owner-gate boundaries.
- If the temporary procedure becomes reusable, skillify it rather than growing the supervisor runtime.

## Use the right tool

Do not expect the current model to do every part of a task.

- Prefer native connectors/APIs and deterministic CLIs/parsers when they can do the operation reliably.
- Use browser automation for dynamic/authenticated/interactive web work when direct retrieval is insufficient.
- Use model capacity for interpretation, judgment, synthesis and genuinely ambiguous work.
- A failed first tool is not a failed task. Follow the relevant fallback chain and change strategy after two materially unchanged failures.
- For YouTube: retrieve human captions, then auto-captions, then download audio and transcribe locally with MacWhisper.

## Primary-source integrity

- When the user gives a specific source, analyze that source rather than silently replacing it with commentary about the source.
- Exhaust the source-specific fallback chain first.
- If the primary source still cannot be obtained, say exactly what failed before offering clearly labelled secondary-source context.
- Preserve provenance so later analysis can distinguish primary from derived/secondary material.

## Autonomy

- Authority comes from the current project policy plus explicit owner direction.
- In owner-approved `build`, continue normal reversible engineering without repeatedly asking to proceed: inspect, edit, branch, worktree, test, run browser QA, fix CI, push feature branches, open/update PRs, create previews, and use already-authorized project integrations.
- Concurrent writers require isolated worktrees and explicit ownership.
- After two materially unchanged failed approaches, change strategy/tool/provider rather than repeat.
- Keep one integration owner and avoid duplicate workers.
- `unattended` remains a separate trust level; do not start background/login execution merely because a project is owner-approved for build.

## Evidence and readiness language

- Agent self-report is not completion evidence.
- Prefer browser/runtime behavior, tests, persisted state, provider response, exact SHA/PR, preview/deploy evidence or explicit human acceptance where appropriate.
- Never claim an external system changed because only local state says it did.
- **BUILT** = implementation exists.
- **VALIDATED** = relevant deterministic checks plus an independent grader support the claim.
- **READY** = a representative real-world outcome succeeded under the intended trust profile.
- Never use built, validated and ready interchangeably.

## Minimum safety floor

Keep only the hard boundaries that protect against large or hard-to-reverse mistakes:

- Never expose or commit secrets.
- Do not create new paid API/credit spend without explicit authority.
- Do not make destructive/irreversible production-data, credential/ownership/DNS or production security-policy changes without explicit authority.
- Client/candidate/PII data stays project-local and must not be promoted into global Major/GBrain/Ruflo memory.
- Do not silently merge data or memory between projects.

These boundaries must not be expanded into generic approval ceremony for ordinary reversible development.

## Emergency stop

`$HOME/.local/bin/major stop` activates the global kill switch. New Major worker execution is blocked until `$HOME/.local/bin/major start` is deliberately run after inspection.

## Self-learning loop

- Solve the real problem first and verify the fix.
- Explicit corrections, repeated mistakes and recurring failures must be captured with `major learn capture`; do not merely apologize or say "remembered".
- Classify each candidate: project-local business/context fact, global policy, tested reusable skill, or memory-only context.
- Repeated candidates increment one durable occurrence count rather than creating duplicate notes.
- When a correction is cross-project, stable, sanitized and procedural, run `skillify` with deterministic tests, resolver positive/negative cases and an integration smoke test.
- Verify the new/updated skill on a later representative real task. A skill file existing is not proof that the resolver actually uses it.
- Prefer a tested skill or deterministic tool over adding another permanent supervisor workflow.
- Rules prevent; tested skills institutionalize; memory reminds.
- Retire duplicate/obsolete custom skills when an upstream capability proves better.

## Legacy cleanup

- Git is the history archive; the active tree should converge to one canonical current path.
- After a replacement is verified, remove obsolete code/config/docs/names and scan for stale references instead of leaving zombie systems active.
