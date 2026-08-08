# Major project operating contract

## Communication

Use BLUF: answer/decision/status first, then only needed context and next action. Use short, direct, active sentences and simple technical English. Keep terminology consistent. Distinguish fact, assumption, risk and recommendation. Do not bury the conclusion in background.

## Prime directive

**MVP and speed are the default.** For a broad request, reduce scope to P0 MVP / P1 next / P2 later. Test the biggest uncertainty in the fastest credible medium, then build P0 end to end before expanding breadth.

A prototype may be UI, code, script, provider call, local slice or another fast proof. Figma is optional, not a required ceremony.

## Build behavior

- Inspect current code/state before editing.
- Prefer a working vertical slice over complete horizontal layers.
- Maintain something visible/testable as early as practical.
- UI may lead backend using clearly labelled fixtures/mocks behind replaceable contracts.
- Reuse proven product patterns, maintained libraries, internal code and open-source systems before rebuilding commodity functionality.
- For normal React/Next.js product UI, prefer shadcn/ui primitives unless the project has a better established system.
- For UI work, use the installed Emil design/motion skills that match the task.
- Keep code simple, modular and replaceable: explicit inputs/outputs, stable boundaries, business rules independent of providers/frameworks where practical.
- Do not add abstraction, infrastructure, tests or documentation without a current reason.

## Autonomy and concurrency

- Continue safe reversible work until the acceptance condition is met or a genuine owner-only gate is reached.
- Do not stop because one command failed or one subtask ended when a safe next action exists.
- After two materially unchanged failed approaches, change strategy/tool/model or isolate the failing boundary.
- Parallelise genuinely independent work. Normal substantive builds can use 4–6 useful workers; capacity may expand to 8 when it shortens the critical path.
- Concurrent writers use isolated worktrees and explicit ownership. Avoid duplicate writers on the same files.
- Continue independent work around one blocked dependency.

## Verification

Completion requires objective evidence appropriate to the outcome: browser/runtime behavior, tests, persisted state, provider response, exact commit/PR state, preview/deploy result or explicit human acceptance when the result is subjective. Agent self-report is not evidence.

Use risk-proportional QA. Optimize confidence per minute, not test count.

## Safety floor

Never expose/commit secrets. Do not spend paid API/credits without authority. Do not make destructive/irreversible production-data, credential/ownership/DNS or production security-policy changes without the required authority. Ordinary reversible development is allowed.

## Legacy cleanup

A migration/rename/provider swap is not complete while obsolete active paths remain. Migrate useful state, verify the successor, delete stale code/config/docs/names, scan for stale references, and finish with one canonical path wherever practical. Git is the history archive.

## Skills

Use task-relevant installed skills. External skills provide technique and are subordinate to this project/Major contract. Do not load specialist skills merely because they exist.
