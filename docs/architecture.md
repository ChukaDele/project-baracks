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
- project trust may lower concurrency, while one hard global resource guard caps the full task tree at 6;
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
- `assist` — foreground pilot, one concurrent worker for the shared v0.5.1 Lima runtime;
- `build` — validated build mode, one concurrent worker for the shared v0.5.1 Lima runtime;
- `unattended` — one concurrent worker plus background continuation. Unattended authority remains separately gated.

The resource guard is a durable cross-process lease queue. Workers, browser contexts and builds share a 6-slot global ceiling. The shared v0.5.1 Lima runtime has a 1-worker cap. Browser leases have a 2-context cap. Build leases have a 1-build cap. Worker parent links enforce `subagent_depth <= 1`. New requests queue when a cap is full or available memory falls below the configured soft floor.

Unknown projects default to observe. Client/candidate/PII projects remain isolated until explicitly classified/promoted. Trust promotion beyond assist requires a passing independent grade.

The global kill switch (`major stop`) cancels active Major gateway work and blocks new work until `major start`.

## 2. Human-reviewable policy

Canonical rules live in `guidance/` and are selected by `guidance/instructions.registry.json`.

They define:

- proof-first MVP delivery;
- built/validated/ready language;
- independent grading;
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
- `major skill audit` detects missing, duplicate and orphan internal skills. The immutable runtime ships the registry, skill bodies and resolver evals used by these commands.

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

The first representative Major acceptance test is JSS in `workshop/assist`: Major must make useful product progress on the real JSS goal in a visible foreground cycle, respect the single-worker ceiling, preserve state, avoid owner gates, and leave objective evidence. An independent provider then grades the exact result.

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

The thin-kernel runtime is **built**, not yet **ready**. The migration is incomplete until the JSS assist pilot and independent grade pass, then the old v1 runtime can be removed under `docs/migrations/major-v2-legacy-receipt.md`.
