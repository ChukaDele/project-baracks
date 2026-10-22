# Major global worker rules

Always-on core. Apply these defaults across projects unless a project/user instruction is more specific. Full procedures live on demand in `~/.major/global-worker-detail.md` ("detail file", source `guidance/global-worker-detail.md`) and `~/.major/stability-invariants.md`; read the named section or skill when its trigger applies.

## Major is the default control plane

- Every substantive engineering or knowledge-work session is Major-managed. CLI: `$HOME/.local/bin/major`. Do not make the user remember or repeatedly invoke Major.
- Attach at session start. Claude does this through a SessionStart hook. In Codex, Cursor and Antigravity, before substantive work run `$HOME/.local/bin/major session attach --cwd "$PWD" --host <codex|cursor|antigravity>` unless the session already shows `MAJOR CONTROL PLANE: ACTIVE`.
- **Presence is not execution authority.** Attaching is presence only. Read the project policy plus explicit owner direction before delegating or starting background work.
- Owner-approved build project, SUBSTANTIVE work (build/fix/redesign/implement/deploy/debug/investigate/modify the repo/QA-and-repair/resolve CI/multi-step build-or-research): first run `$HOME/.local/bin/major goal admit --host <host> --outcome "<durable outcome, not the latest step>"`, once per new increment. Skip it for lightweight interaction (explain, answer, opine, summarize, read-only inspection) unless a goal is already active. Read the echoed `outcome`; pass `--refine` only when it plainly does not match the current request.
- Then DISPATCH through Major instead of implementing yourself: `$HOME/.local/bin/major run <project> --goal-id <id> --foreground` with a long-running/background command (up to `maxRunMinutes`). Major reroutes provider failures inside the same goal. You are the controller: report the result; never make the same repo mutation in parallel; never start a second dispatch for a goal that is running. Next increment = admit/resume and dispatch again. Full detail: detail file, "Major is the default control plane".
- Preserve an active goal's durable outcome across the session. Run `$HOME/.local/bin/major status <project>` before declaring a project complete or blocked.
- Client/candidate/PII data stays project-local and never flows into global Major/GBrain/Ruflo memory.

## Trust levels

`observe` (no worker execution; write a **MAJOR SHADOW PLAN** for a human driver; **Three consecutive passing shadow grades** may earn `assist`) → `assist` (foreground pilot, 30-minute coordinator limit) → `build` (normal foreground, 120-minute coordinator limit; reached by evidence or explicit `--owner-approved`) → `unattended` (background; needs a representative build result plus a fresh independent grade; owner-approved build never grants it silently). An explicitly authorized `SUPERVISED_WORKSHOP` session is foreground, expiring and project-bound and does not replace the exact-SHA Secure Enclave gate for a frozen release. In owner-approved build, continue ordinary reversible engineering (inspect, edit, branch, worktree, test, browser QA, fix CI, push feature branches, open/update PRs, previews) without shadow runs, repeated permission prompts or ceremonial review loops.

## Working method

- Start with the smallest credible end-to-end MVP. Make it work, make it useful, then improve or harden it. Work from the critical path; prefer deletion, reuse and simpler design. Default to the smallest correct modular implementation (detail: `simple-modular-code`).
- Maximise useful concurrency within capacity, trust policy and write ownership. Serialize only actual conflicts. Treat worker/browser caps as current physical/runtime capacity; never bypass them. Concurrent writers need isolated worktrees and explicit ownership; keep one integration owner.
- Match validation and independent review to risk. By default require focused changed-behavior tests, the cheapest relevant compile/type/build check, critical-path behavior, and checks for each material risk. Do not run broad suites unless explicit blast-radius, shared-dependency, insufficient-evidence, historical-regression, or promotion-policy triggers apply, or repository policy requires them. Record broad validation's cost versus expected information gain and run it only when that tradeoff supports the promotion decision. Do not add review loops that do not change the decision.
- After two materially unchanged failed approaches, change strategy, tool or provider.
- Communication: BLUF, short active sentences, simple technical English; consistent terms; explain unavoidable jargon once; never bury the recommendation; separate fact, assumption, risk, recommendation and next action when mixing them could mislead.

## On-demand rules (trigger → where the full rule lives)

Each line is binding. Load the named skill or detail-file section before acting on its trigger.

- Prior art before new infrastructure: before a new subsystem, provider integration, runtime, sandbox, router, memory, auth, scraper, workflow engine, browser system, MCP integration, installer, deployment mechanism or major dependency, check prior art and record ADOPT/WRAP/BORROW/BUILD in `docs/prior-art-decisions.md` first; BUILD is last. Skill: `prior-art-discovery`.
- Remote-first web: for web projects, persistent local servers and local browser navigation are denied unless the owner explicitly opts in for that specific project; never open localhost/127.0.0.1/[::1]/0.0.0.0/.local or a local port for preview, QA, E2E or user links (a trusted CLI's loopback OAuth callback is the only exception); replace a generic skill's `npm run dev`/local-URL preview step with a Cloudflare preview; run `major web preflight --preview-url <Cloudflare URL> --github-url <GitHub URL> --production-branch main` before any browser action. Skill: `remote-first-web-development`.
- Auth, OAuth, consent, 2FA, CAPTCHA, payment or an irreversible account/domain decision blocks work: skill `human-blocker-orchestration`; block only the dependent branch and continue independent work.
- Use the right tool: prefer native connectors/APIs/deterministic CLIs; a failed first tool is not a failed task. Tools as Code: use short temporary code for repeated deterministic tool calls, never to bypass filesystem, credential, client-data, paid-spend or owner-gate boundaries (skill `tools-as-code`).
- Primary-source integrity: analyze the source the user gave; exhaust its fallback chain and say exactly what failed before using labelled secondary sources (skill `source-ingestion`).
- Skill-first: resolve the smallest relevant installed skill set before inventing a workflow; skillify a successful novel recurring procedure after the real task succeeds.
- Learning: an explicit user correction, "this happened before"/"we already fixed this", evidence contradicting you, a repeated mistake or a recurring failure is a learning event. Fix and verify the task, then run `major learn capture` project-locally without being asked. Global promotion is a separate reviewed action that needs sanitized content and evidence (detail: "Self-learning loop").
- Before planning or implementing substantive work, read detail sections "Operating principle", "Speed / MVP", "Code simplicity" and "Skill-first execution". New project or project shape: `project-start` and detail "Foundry project intake". YouTube/media sources: detail "Use the right tool". Verified replacement: remove obsolete code/config/docs/names and scan for stale references (`legacy-cleanup`).

## Stability invariants (full text: `~/.major/stability-invariants.md`)

1. Confirm the Git root/remote matches the task's project before substantive edits; reroute with `project-context-integrity`; if two targets are genuinely plausible, ask one concise question before mutation; reading a reference project never authorizes writing to it; a correct fix in the wrong repo is a failed task.
2. At substantive start, read project `LEARNINGS.md`, check `major learn list --project current`, load the smallest relevant skill set; a learning that recurs twice must be promoted or explained.
3. Integration states are distinct (`installed → configured → exposed → authenticated → permissioned → operational → integrated`); prove the state with a real operation (`mcp-integration-ops`).
4. Creating, cloning, locating, moving, parking, deleting or archiving projects, or storage pressure: `workspace-lifecycle-management`; never create a duplicate clone because the expected path is missing; never delete or park a clone without checking local-only commits, untracked/ignored files and non-Git state.
5. Customer-facing websites: `website-design-qa` (+ `responsive-motion-systems` for GSAP, ScrollTrigger, sticky/pinned storytelling, hero video, card stacking, parallax or Three.js); browser evidence for visual claims; 100% zoom is the baseline; preserve approved interactions and repair architecture rather than deleting motion to make tests pass.
6. In Major/project-baracks: `major-self-maintenance`; no material direct change to `main`; skill promotion is atomic (skill + registry + resolver eval + catalog/validator); full gate before merge; independent review for consequential routing/learning/authority changes; never start a self-change while `main` is red.
7. Push back when an instruction conflicts with stronger project truth; take the safer reversible route; ask only on real ambiguity or owner-only decisions.
8. Prior art before new infrastructure (above); a BUILD without a recorded prior-art check is a process failure even if the code works.

## Global resource guard

- There is no fixed resource ceiling. Major derives worker, browser and build limits from live memory headroom (and CPU for builds); parent agents, child agents, nested subagents, QA workers, browser workers and build workers all draw on that one host budget.
- Subagent depth has no default cap. Child workers take a parent-linked worker lease; the owner may set `MAJOR_MAX_SUBAGENT_DEPTH`.
- Before starting a worker, browser or build, acquire a Major lease with `major resource acquire --kind <worker|browser|build> --owner <stable-owner> --project <project>`. Pass `--parent <lease-id>` for child workers. Release it immediately after the work with `major resource release --lease <lease-id>`.
- A queued result is not permission to start. Wait until Major promotes the request.
- Browsers: limited by memory headroom. Reuse contexts and close each viewport/page set promptly.
- Builds: limited by memory and CPU. Build once per relevant commit. Reviewers inspect the same immutable remote preview.
- Major admission checks the shared resource ledger and memory availability. Below the memory soft floor, new work queues instead of increasing pressure.
- Use `major resource status` for lightweight telemetry: workers, browsers, builds, total active, queued and memory availability.
- QA uses the shared live resource ledger: review, consolidate and repair, then run the next reviewer and final verifier when capacity and token economics justify it. This is a current scheduling rule, not a fixed one-worker limit.

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
