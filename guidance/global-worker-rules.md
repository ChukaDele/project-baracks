# Major global worker rules

Apply these defaults across projects unless a project/user instruction is more specific.

## Major is the default control plane

- Every substantive engineering or knowledge-work session is Major-managed by default.
- Major's canonical local CLI is `$HOME/.local/bin/major`.
- At session start, attach to Major. Claude does this through a SessionStart hook. In Codex, Cursor and Antigravity, before substantive work run `$HOME/.local/bin/major session attach --cwd "$PWD" --host <codex|cursor|antigravity>` if the session has not already shown `MAJOR CONTROL PLANE: ACTIVE`.
- Do not make the user remember or repeatedly invoke Major.
- **Presence is not execution authority.** Read the current project trust profile before delegating or starting background work.
- Unknown projects default to `unknown/observe`. Client/candidate/PII projects default to `client/observe` until explicitly classified/promoted.
- If an active Major goal exists, preserve the durable outcome across the session rather than treating the latest message as an isolated micro-task.
- A small bounded request may execute directly under the current project trust profile. A broad/multi-step outcome should become a durable Major goal.
- Use `$HOME/.local/bin/major status <project>` before declaring a project complete or blocked.

## Trust levels

- `observe`: context/planning/inspection only; no delegated execution.
- `assist`: foreground pilot, maximum 3 useful workers, no unattended loop.
- `build`: validated autonomous build work, maximum 6 useful workers; no login/unattended execution by default.
- `unattended`: maximum 8 useful workers; background continuation is allowed only after representative real-output validation and an independent grade.

Do not promote trust because configuration exists or self-authored tests are green.

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

## Skill-first execution

- Resolve the smallest relevant set of installed skills before inventing a new workflow.
- Installed does not mean loaded; avoid irrelevant or overlapping skills.
- Prefer markdown judgment + minimal deterministic code over permanent hard-coded orchestration.
- If a successful novel procedure is likely to recur, use `skillify` after the real task succeeds.
- Do not skillify trivial one-offs or pause an active P0 to build tooling.

## Tools as Code

Use short temporary code when repeated deterministic tool calls would otherwise consume many model turns.

Good cases include retrieve/fan-out/filter/dedupe/rank, batch transformations, repeated validation and source normalization.

- Prefer native connectors/APIs/CLIs as primitives.
- Use generated code for mechanics; use the model for judgment/synthesis.
- Keep provenance.
- Do not use code to bypass Major trust, filesystem, credential or owner-gate boundaries.
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

- Continue safe, reversible work until acceptance criteria are met or a genuine owner-only gate remains.
- Do not stop merely because one command failed, one subtask ended, one PR merged, or one dependency is blocked while independent P0 work remains.
- Concurrent writers require isolated worktrees and explicit ownership.
- After two materially unchanged failed approaches, change strategy/tool/provider rather than repeat.
- Respect the project trust-level worker ceiling; never treat the global maximum of 8 as the default.

## Evidence and readiness language

- Agent self-report is not completion evidence.
- Prefer browser/runtime behavior, tests, persisted state, provider response, exact SHA/PR, preview/deploy evidence or explicit human acceptance where appropriate.
- Never claim an external system changed because only local state says it did.
- **BUILT** = implementation exists.
- **VALIDATED** = relevant deterministic checks plus an independent grader support the claim.
- **READY** = a representative real-world outcome succeeded under the intended trust profile.
- Never use built, validated and ready interchangeably.

## Safety / blast radius

- Never expose or commit secrets.
- Do not create new paid API/credit spend without authority.
- Do not perform destructive/irreversible production-data, credential/ownership/DNS or production security-policy actions without the required authority.
- Client/candidate/PII data stays project-local and must not be promoted into global Major/Ruflo memory.
- Ruflo or other experimental swarm/memory machinery is not globally authorized merely because Major is present.
- Ordinary reversible development may proceed only when the project trust profile permits execution.

## Emergency stop

`$HOME/.local/bin/major stop` activates the global kill switch. New worker execution must stop and active Major gateway workers must be cancelled. Resume only with `$HOME/.local/bin/major start` after inspection.

## Legacy cleanup

- Git is the history archive; the active tree should converge to one canonical current path.
- After a replacement is verified, remove obsolete code/config/docs/names and scan for stale references instead of leaving zombie systems active.
