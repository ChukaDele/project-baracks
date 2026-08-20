# Major

**Major is a thin cross-project control plane for software delivery and evidence-based knowledge work.** It owns durable goals, project trust, tool/worker routing, evidence, stop controls and reusable learning. It should not become a giant hard-coded workflow factory.

## Prime directive

**Get to a credible end-to-end proof fast.**

For software:

1. identify the core user/business outcome;
2. reduce broad scope to P0 MVP / P1 next / P2 later;
3. test the biggest uncertainty in the fastest credible medium;
4. build the P0 value loop end to end;
5. keep progress demonstrable;
6. verify the real path;
7. keep working the highest-impact missing P0 node until the goal is true or a genuine owner gate remains.

For knowledge work: **minimum credible evidence for the next good decision**.

## Thin kernel, fat skills

Permanent Major code stays focused on deterministic control-plane concerns:

- durable goal/project state;
- project class and trust;
- worker/tool availability;
- worktree/process lifecycle;
- kill switch;
- evidence/audit boundaries;
- owner gates;
- provider/cost restrictions.

Reusable procedure belongs in tested skills. Repeated deterministic mechanics can be composed at runtime with `tools-as-code`. A successful novel procedure becomes a reusable skill only after it works, via `skillify`.

Toolsmith keeps the related capability question separate: it records and
reuses project-scoped tools/adapters only after preflight and independent
validation. It never installs blindly or opens a runtime authority gate. See
[Toolsmith and validation](docs/toolsmith.md).

## Always present, owner-controlled authority

Major's communication/routing/project context should be present across supported agent tools. The owner decides how much execution authority each project receives.

Project classes:

- `unknown`
- `workshop`
- `client`
- `knowledge`

Trust levels:

- `observe` — no Major worker execution; useful for new/untrusted projects or deliberate shadow evaluation;
- `assist` — visible foreground pilot, max 3 useful workers, max 30 minutes per coordinator run;
- `build` — normal foreground coordination, max 6 useful workers, max 120 minutes per coordinator run;
- `unattended` — max 6 useful workers and background continuation.

The owner may explicitly fast-track a trusted project directly into `build` with `--owner-approved`. This bypasses shadow/assist ceremony for normal foreground work. It does **not** silently grant unattended/background authority.

Client/candidate/PII projects may run in `client/build`, but their data stays project-local and cannot enter global Major/GBrain/Ruflo memory.

## Install

```sh
bash scripts/install-major-runtime.sh
```

For an explicitly authorized development session, install the reviewed main snapshot without starting final release attestation:

```sh
MAJOR_ACTIVATION_MODE=supervised-workshop bash scripts/install-major-runtime.sh
```

This installs:

- global `major` CLI;
- global Major rules for Claude/Codex/Cursor/Antigravity;
- deterministic Claude `SessionStart` attach;
- durable goal/policy state;
- scoped worker adapters and execution gateway.

It does **not** auto-start a Mac login daemon and does **not** attach Ruflo globally.

The optional pinned DSH workstation launcher is staged by
`scripts/install-deepseek-harness-pin.sh` as `${MAJOR_APP_DIR:-$HOME/Applications}/Major.app`;
its launcher and runtime state remain under `$MAJOR_HOME/dsh-harness`.
Start it with `bash scripts/start-major-workstation.sh --project /path/to/repo`.
Normal trusted repository mutation runs through the native DSH Codex worker in
the local environment, followed by native Claude review. Cursor and Antigravity
remain legacy-compatible until live DSH adapters pass the same gates. Set
`MAJOR_DSH_EXECUTION_ENVIRONMENT=lima` for optional high isolation or `legacy`
for the old Major/Lima compatibility pipeline.

`major provider sync-profiles` makes only owner-policy rows with `role: active`
routable. A removed, disabled, missing, or failed profile immediately loses
routing eligibility. Its root-only guest credential is retained for rollback;
credential deletion remains an explicit owner operation.

## Recommended working mode for trusted projects

JSS:

```sh
major project configure jss-tool \
  --class workshop \
  --trust build \
  --owner-approved \
  --allow-external-writes
```

Surface Talent:

```sh
major project configure surface-talent \
  --class client \
  --trust build \
  --owner-approved \
  --allow-external-writes
```

`--allow-external-writes` authorizes normal project writes such as branches, PRs, preview deployments and already-authorized integrations. It does not authorize new paid spend, destructive production-data changes, credential/ownership/DNS changes or production security-policy changes.

Then open a fresh Claude/Codex/Cursor session inside the relevant repo and work normally. No `start Major` prompt is required.

Authorize the visible controller session once:

```sh
major session authorize \
  --mode supervised-workshop \
  --host codex \
  --cwd "$PWD" \
  --owner-approved
```

`SUPERVISED_WORKSHOP` is project-bound, expires after eight hours, and never enables background or global execution. It may create many project commits without another release signature. Revoke it with `major session revoke --cwd "$PWD"` or stop all execution with `major stop`.

Secure Enclave signing is reserved for `FINAL_RELEASE_ATTESTATION`: freeze one candidate, run deterministic checks and exact-head CI, sign once, then run final fields and independent review. A code change aborts that attestation and returns the work to Workshop mode.

## Optional evidence-first path

For a new or untrusted project, keep the stricter ramp:

```text
observe → assist → build → unattended
```

The shadow/grade machinery remains available when you deliberately want it. It is not required for an owner-approved trusted project to enter foreground build mode.

## Emergency stop

```sh
major stop
```

Resume after inspection:

```sh
major start
```

## Minimum safety floor

Major should not turn ordinary reversible development into approval ceremony. The hard boundaries are:

- never expose or commit secrets;
- no new paid API/credit spend without explicit authority;
- no destructive/irreversible production-data changes without explicit authority;
- no credential/ownership/DNS or production security-policy changes without explicit authority;
- client/candidate/PII data stays inside its project boundary and never enters global memory.

Everything else that is normal reversible engineering may proceed in owner-approved `build`: inspect, edit, branch, worktree, test, browser QA, CI repair, feature-branch pushes, PRs, previews and already-authorized project integrations.

## Built, validated, ready

Major uses these terms deliberately:

- **BUILT** — implementation exists.
- **VALIDATED** — relevant deterministic checks plus independent evidence support the claim.
- **READY** — a representative real-world outcome succeeded under the intended trust profile.

Owner approval grants authority; it does not convert an unproven result into evidence.

## One kernel, two profiles

### Major Build

Software delivery: MVP planning, implementation, worktrees, browser QA, previews, repair loops, CI recovery and objective runtime evidence.

### Major Knowledge

Research/strategy/synthesis: primary-source ingestion, source-specific tool routing, Tools-as-Code for repeated retrieval mechanics, materially different research angles, skeptic review where justified and decision-focused synthesis.

## Tool/capability router

```text
GitHub → GitHub connector/API
Google files/mail/calendar → native Google connectors
Figma → Figma tooling
public static web → direct fetch/search
JS-heavy/authenticated web → browser/GStack when needed
YouTube → yt-dlp captions → auto-captions → audio → local MacWhisper mw
local audio/video → MacWhisper
PDF/document/spreadsheet → native parser/skill
reasoning/synthesis → routed model(s)
```

**A failed first tool is not a failed task.**

## Ruflo

Ruflo is optional subordinate infrastructure, not Major's source of truth and not a global dependency. Enable it only where real project results show that it improves outcomes enough to justify the extra orchestration.

## Rules, skills and memory

- binding policy: `guidance/instructions.registry.json`;
- global worker rules: `guidance/global-worker-rules.md`;
- recurring skill registry: `guidance/skills.registry.json`;
- internal skills: `skills/internal/`;
- human-reviewable reusable knowledge: Git/Markdown;
- project/private knowledge: project-local namespaces;
- client/candidate/PII data never enters global Major/GBrain/Ruflo memory.

## Runtime migration boundary

Major v0.4.1 keeps the evidence-based trust ramp available while adding an explicit owner-approved foreground build fast path. Unattended authority remains separately earned.
