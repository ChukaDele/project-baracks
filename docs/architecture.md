# Major architecture

Major is a **thin cross-project control plane** for building software and doing evidence-based knowledge work. It owns durable goals, project trust, worker/tool routing, evidence, budgets/gates and learning. It should not become a large hard-coded workflow factory.

## Core design principle

**Thin deterministic kernel. Fat tested skills. Agents compose tools/code at runtime.**

Keep permanent code only for state and boundaries that must be deterministic. Put judgment/procedure into skills. Let agents create short temporary code for repeated mechanics, and skillify procedures only after they work.

```text
user goal
   ↓
Major kernel
(goal / state / trust / stop / evidence)
   ↓
skill resolver
   ↓
relevant tested skill packs
   ↓
agent
   ↓
reason directly | native tool | Tools-as-Code | dynamic worker graph
   ↓
evidence / independent grade
   ↓
reusable success? → skillify
```

## One kernel, two internal profiles

### Major Build

Used to make and ship software.

- proof-first P0 MVP delivery;
- worktree isolation and explicit write ownership;
- code, browser QA, preview deployments, repair loops and objective runtime evidence;
- project trust and current physical capacity may lower concurrency, while one hard global resource guard caps the full task tree at 6;
- multi-agent graphs are created only when independent parallel work earns their coordination cost.

### Major Knowledge

Used for research, strategy, synthesis, comparisons and decision work.

- define the decision and minimum credible evidence first;
- ingest named primary sources with the best connector/API/CLI/parser/browser/local tool;
- use light, standard or high-stakes depth rather than a fixed swarm size;
- use Tools-as-Code for repeated retrieve/filter/dedupe/rank/transform mechanics;
- use an independent skeptic/reviewer when consequence or uncertainty warrants it;
- preserve provenance and separate evidence from inference.

These are profiles of the same Major kernel, not separate harnesses.

## 1. Always present, not always authorized

Major's communication/routing/project context is present across supported agent tools. Execution authority is project-scoped.

Project classes:

- `unknown`
- `workshop`
- `client`
- `knowledge`

Trust levels:

- `observe` — no delegated execution;
- `assist` — foreground pilot through the headless Major path;
- `build` — validated build mode through the headless Major path;
- `unattended` — background continuation. Unattended authority remains separately gated.

The resource guard is a durable cross-process lease queue. Workers, browser contexts and builds share a 6-slot global ceiling. Workers have a hard project ceiling of four, while the live CPU and memory guard may lower the usable count at admission. This is a resource safeguard, not a permanent one-worker governance model. Browser leases have a 2-context cap. Build leases have a 1-build cap. Worker parent links enforce `subagent_depth <= 1`. New requests queue when a cap is full or available memory falls below the configured soft floor.

Unknown projects default to observe. Client/candidate/PII projects remain isolated until explicitly classified/promoted. Trust promotion beyond assist requires a passing independent grade.

The global kill switch (`major stop`) cancels active Major gateway work and blocks new work until `major start`.

Foreground execution has two separate authorization modes:

- `SUPERVISED_WORKSHOP` is an expiring controller-session capability for one owner-approved build project. The gateway and selected execution boundary recheck the session, project identity, worker resource lease and kill switch. It permits project-local autonomous work across multiple Git SHAs. It does not grant unattended execution or bypass provider action policy.
- `FINAL_RELEASE_ATTESTATION` is the existing exact-SHA Secure Enclave authority. It applies only after a candidate is frozen. Any code change ends that attestation; the next frozen candidate requires one new signature.

The Workshop session may authorize the existing provider-state broker to copy only the four fixed provider authentication files from a prior isolated worker to a new release worker. The transfer stays VM-to-VM, is provider-scoped and audited, and never promotes project/session/workspace state.

## 2. Human-reviewable policy

Canonical rules live in `guidance/` and are selected by `guidance/instructions.registry.json`.

They define:

- proof-first MVP delivery;
- make-it-work, make-it-useful, then improve delivery;
- reuse-first decisions and the critical path;
- shared current-goal state, explicit ownership and interface boundaries;
- useful concurrency with serialization only for real conflicts;
- built/validated/ready language;
- risk-proportionate validation and independent grading;
- project trust/blast radius;
- tool/source routing;
- autonomy/recovery;
- legacy cleanup;
- communication;
- proportional security;
- model/provider routing;
- project-state rules.

## 3. Skill resolver and reusable skills

- Major internal skills: `skills/internal/`;
- external skills: installed through the canonical installer and locked to source commits;
- installed does not mean loaded;
- the resolver selects the smallest useful skill set;
- positive/negative trigger examples and reachability/overlap checks are part of the skill lifecycle.
- `major skill resolve --task "..."` returns paths and metadata only for installed, reachable skills;
- `major skill assets --task "..."` retrieves verified reusable-asset metadata and locators without loading or executing asset bodies;
- `major skill sync` activates an immutable Skills Library bundle and `major skill rollback` atomically restores the newest retained bundle without changing the active Harness;
- `major skill audit` detects missing, duplicate and orphan internal skills. The immutable runtime ships the registry, skill bodies and resolver evals used by these commands.
- successful workers may emit one bounded workflow observation. GBrain keeps it project-local, detects semantic recurrence, holds overlaps for an existing skill update, and promotes only recurring independently validated procedures;
- generated skill state extends the existing project learning lifecycle. It is not a second registry. Active records are resolved by the canonical skill resolver;
- generated `SKILL.md` files follow the Agent Skills format. Usage outcomes update routing confidence. Repeated poor outcomes deprecate a skill without deleting provenance;
- automatic global generation is forbidden. Cross-project promotion still requires the existing sanitized learning review and project policy.

Important recurring meta-skills:

- `skill-resolver`
- `skillify`
- `tools-as-code`

Skills provide technique. Major guidance has higher authority.

## 4. Tools as Code

When repeated deterministic operations would otherwise require many model turns, an agent may compose approved primitives with a short temporary Python/TypeScript/shell program.

Typical primitives:

- search/retrieval adapters;
- browser/GStack;
- GitHub;
- Google connectors;
- Figma;
- `yt-dlp`;
- MacWhisper;
- file/PDF parsers;
- deterministic transforms/validators.

Use code for mechanics, not judgment. Temporary code is discarded unless it has durable product value or is promoted through `skillify`.

## 5. Tool/capability router

Typical routes:

- GitHub → GitHub connector/API;
- Google files/mail/calendar → native Google connectors;
- Figma → Figma tooling;
- public static web → direct fetch/search;
- dynamic/authenticated web → GStack/browser when needed;
- YouTube → `yt-dlp` captions → auto-captions → audio → local MacWhisper `mw`;
- local audio/video → MacWhisper;
- PDF/document/spreadsheet → native parser/skill;
- reasoning/synthesis → dynamically selected model(s).

A failed first tool is not a failed task.

### Toolsmith lifecycle

Toolsmith extends this router with a project-scoped capability lifecycle. It
reuses proven local capability records first. A missing safe capability is
discovered, provisioned, verified, and returned to the original goal in the
same supervisor cycle. A missing capability is assessed
from bounded candidate facts, never blindly installed. A passing preflight
creates a `provisional` record. A capability-specific artifact is required for
every validation. Manual validation also requires a passed persisted run from
a reviewer distinct from the candidate discoverer. The process-free local
catalog can verify only Major's existing low-risk path adapter, with a
separate deterministic verifier and exact runtime source-revision binding. Repeated verified
outcomes can make a capability `preferred`; failures degrade it; deprecation
removes it from routing without deleting provenance. See
[Toolsmith and validation](toolsmith.md).

Toolsmith records cannot change the immutable runtime capability gates. They
also do not create skills. The existing GBrain skill lifecycle promotes only
repeated, independently validated successful workflows.

## 5.1 Artifact-aware validation and ship gate

Major runs deterministic artifact-specific checks before an independent/model
review. Writing, code, analysis, presentation, and web
outputs use distinct evidence contracts rather than one generic judge prompt.
The web ship gate blocks on missing applicable functional, data, visual,
technical, performance, security, deployment, and public-site SEO evidence.
It does not treat a build, a preview URL, or a policy record as runtime proof.

## 6. Worker adapters

Thin adapters invoke available coding/reasoning environments:

- Claude Code;
- Codex;
- Google Antigravity;
- Cursor Agent CLI.

The executable contracts are `claude`, `codex`, `agy` and `cursor-agent`. Major does not substitute the Cursor editor command for the separate headless CLI and does not substitute an uninstalled Antigravity Python SDK for the official `agy` CLI. Provider installation, OAuth, workspace trust and tool-permission selection remain interactive user setup. Major never adds Antigravity's dangerous permission-bypass flag. A provider is routable only after persisted availability plus authoritative billing observation; executable presence alone grants nothing.

Worker/model choice is dynamic. Prefer subscription-included capacity. Paid API/credit spend remains an explicit authority boundary.

Major should not encode fixed permanent agent factories. The coordinator may create a small dynamic worker graph when the task contains genuinely independent work.

## 7. Ruflo

Ruflo is **optional subordinate infrastructure**, not the default global control plane.

It may provide swarm/memory/workflow primitives for trusted workshop projects after pilot evidence shows the benefit outweighs coordination/blast-radius cost.

During pilot:

- Ruflo is not attached globally;
- client projects do not inherit Ruflo/global memory;
- Major can operate directly through its worker adapters without Ruflo.

## 8. Execution and recovery

- execution runs through Major's gateway;
- project policy decides whether delegation/background work is allowed;
- concurrent writers use worktrees;
- two materially unchanged failed strategies trigger a different strategy/tool/provider;
- background daemon processing is restricted to explicitly promoted `unattended` projects;
- pilot deployment does not auto-start a login daemon.

## 9. Verification and readiness

**BUILT** = implementation exists.

**VALIDATED** = relevant deterministic checks plus an independent grader support the claim.

**READY** = a representative real-world outcome succeeded under the intended trust profile.

Builder-authored CI is useful but cannot by itself promote trust.

The first representative Major acceptance test is JSS in `workshop/assist`: Major must make useful product progress on the real JSS goal in a visible foreground cycle, respect the single-worker ceiling, preserve state, avoid owner gates, and leave objective evidence. A separate read-only review execution then grades the exact result with durable provider/account provenance.

## 10. Memory and learning

Three distinct stores:

1. **Git/Markdown** — human-reviewable rules, skills and verified reusable lessons.
2. **Project/personal state** — project-specific decisions, architecture, research context, blockers and sensitive domain context.
3. **Derived runtime/vector memory** — searchable index/task outcomes/retrieval support when enabled.

Learning priority:

`deterministic rule/tool → tested skill → memory`

Only sanitized transferable lessons cross into global Major learning. Client/candidate/PII material never does.

Project learning candidates are stored in physically separate opaque project files. Direct global capture is forbidden. Global promotion requires a recurring project candidate plus newly supplied sanitized summary and evidence. Global records contain no project identity, repository path or project-local evidence. Promoted project and global lessons are recalled in fresh session and coordinator context; dismissed lessons are not.

## Communication adapters

Major maintains one canonical communication contract and installs it into supported global/project instruction surfaces. Claude has a deterministic SessionStart hook; other hosts rely on their supported persistent instruction surfaces and must be field-verified rather than assumed equivalent.

## Delivery architecture

Software:

**fastest credible proof → P0 vertical slice → real critical path → evidence → expand/harden**

Knowledge work:

**decision → biggest uncertainty → minimum credible evidence → primary-source ingestion → analysis/skeptic → recommendation → act/learn**

## Product-runtime boundary

Major may build product-specific AI systems, but those shipped runtimes are not Major. Client/product runtimes receive only the permissions, skills, memory and data needed for that product.

## Legacy rule

Git history is the archive. After a successor path is independently validated on real output, obsolete v1 code/docs/config/flags are deleted from the active tree unless a real current consumer requires a temporary shim.

## Migration status

The thin headless Major runtime is the default live workstation. It runs
approved provider CLIs through the host containment boundary and uses Orca for
workspaces, worktrees, terminals, agent operations and operational status. The
local Major UI is an intelligence and control surface only. The migration
remains recoverable under `docs/migrations/deepseek-harness-strangler.md`:
Lima and the old DSH pipeline are explicit compatibility/reference paths, not
the normal execution route, until their active consumers reach zero.

Major keeps compact append-only run receipts and project learning in its own
durable store. High-volume provider/session telemetry remains an observability
concern with an exporter seam. Langfuse or OpenTelemetry is optional and is not
required for active work. GBrain stores the meaning derived from evidence, and
Major uses repeated validated evidence to change routing, policy, skills or
resource decisions.

Migration cleanup is incomplete until obsolete active consumers reach zero and
the canonical installed workstation passes its release gates.

## 10.1 Normal headless Major path

Normal execution is selected and inspected with:

```sh
major execution status --json
major execution select --path host
```

The `host` path is the default. Major resolves a trusted provider executable,
applies the project policy and resource lease, and runs it through macOS
Seatbelt with explicit project/runtime roots and outbound-only networking.
Codex, Claude Code, Cursor and Antigravity remain official CLI adapters. A
provider's CLI owns its credentials. Major does not copy credentials into a
second runtime on this path.

`major provider probe --provider <name>` records an append-only live CLI
observation. `major history report --project <identity>` reports compact run
receipts with useful-work duration, infrastructure overhead, worker/provider,
skills, failures, interventions, quality and outcome. The UI reads these same
Major interfaces and never starts a worker or embeds a second memory store.

Orca is the primary operational substrate. Its supported UI, CLI, MCP and
worktree facilities own terminal, Git, browser, agent-status, notification and
workspace operations. Major remains the headless intelligence, policy,
continuity and learning layer above them.

`major execution select --path lima` is an explicit compatibility choice for
the retained Lima backend. It is not selected by the normal host path and its
historical receipts remain protected.

## 10.2 DeepSeek Harness distribution (retained compatibility/reference)

DeepSeek Harness is retained as a historical, reference and explicit
compatibility substrate. It is not the normal Major worker backend. Major does
not fork it. Exact npm versions are pinned; `latest`, `next` and version ranges
are refused.

Major-specific capabilities remain behind a thin control-plane seam. The
`@major/dsh-kernel` bundle is the thin integration seam after
`@deepseek-ai/dsh-base`. It registers `/major`, delegates work through the
existing Major control plane, and uses DSH's official Claude Code provider for
independent review. Each remaining capability moves behind that seam only after
its adapter and conformance proof exist:

- durable goals, GBrain/learning, skill resolver and Toolsmith;
- project trust, approval policy and kill switch;
- independent evidence;
- subscription routing and project-context integrity;
- provider-independent execution-environment policy, with the host Seatbelt
  path as the normal route and Lima as optional compatibility isolation.

The historical unified Mac workstation used two source profiles on that pin:
loopback Web UI for the owner and headless for Major-driven runs. Neither
profile starts a login daemon or attaches Ruflo globally. Its conformance,
install-plan, pinned package and marked-app checks remain useful provenance and
recovery evidence. `major harness workstation-app` and `pnpm validate:dsh` are
therefore compatibility/reference operations only. They must not be used as an
invisible second production path or as a prerequisite for normal host work.

## 11. Resource hygiene

Resource efficiency is designed before creation, enforced during operation, reconciled after operation, and continuously verified.

Major does not invent a store manager. It classifies, applies retention policy and reports; reclamation is delegated to `limactl delete` / `limactl prune`, `git worktree prune`, `pnpm store prune`, and recursive removal of Major-owned ephemeral trees.

### Resource classes

Every inventoried resource has exactly one class:

| Class | Meaning | Deletable |
|---|---|---|
| `active` | Active release or active worker from declared GC roots | never |
| `rollback` | Newest rollback generation (`ROLLBACK_GENERATIONS = 1`) | never |
| `credential-bearing` | Only remaining source of a provider credential absent from the active worker | never |
| `cache` | Reconstructible cache inside its 14-day window, or expired cache | expired only |
| `ephemeral` | Staging, test workers, failed destination workers, in-window logs/runs/worktrees | when immediate or outside window |
| `orphan` | Identity matches no root and no retention window | yes |
| `cold-archive` | Old immutable snapshots, logs and diagnostics beyond retention | compact/archive only |
| `unknown` | Major cannot classify confidently | never (safe default) |

GC roots are read, never guessed: `installed-release.json`, `install-history.jsonl`, `execution.json`, active resource leases and live supervisor goals.

### Retention windows

| Resource | Window |
|---|---|
| Execution run-state dirs | newest 10 and anything younger than 48h |
| Logs | 7 days |
| Caches | 14 days |
| Temp worktrees | prune when the directory is gone or older than 7 days |
| Install staging | newest 1; remove on success |
| Staged-validation | newest 1 |
| Test workers | remove immediately after the test run |
| Toolsmith provisional capabilities | 24h if never validated |
| Diagnostic artifacts | 14 days |
| Failed destination workers | remove immediately |
| Lima compatibility workers | active + 1 rollback generation + unique credential-bearing; no VM per SHA |

Dry-run reclaim is an explicit allocated-blocks **upper bound**. Apply reports the measured `df` free-bytes delta. A `du` sum is never presented as actual reclaimed space.
