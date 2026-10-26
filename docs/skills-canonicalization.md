# Skills canonicalization (2026-10-23)

## Result

- Every installed skill now has one recorded decision: used, fixed, kept with a reason, removed, or waiting for an owner decision (see the table at the end).
- The resolver now passes 35 of 35 held-out natural-language cases: 21 must-route cases and 14 must-not-route cases. Before this change it passed 22 of 35. It missed 11 must-route cases, and 2 must-not-route prompts already picked up the wrong skill.
- One canonical home per skill. Major-owned skills live in this repository. Shared skills live in `~/.agents/skills`. After the host script runs, every skill name that exists in more than one host directory resolves to one source, and every Major-owned name links to the repo. `scripts/check-skill-drift.py` enforces this in `scripts/validate-major.sh`. A skill that exists in only one host directory is allowed.
- The GStack uninstall from Claude (owner-approved) and every host move are scripted in `scripts/canonicalize-host-skills.sh`. It archives to `~/.major/backups/skills-archive-<date>/` and never deletes. Major's setup no longer reinstalls GStack. **The host script has not run yet** (section 5).

## 1. Evidence: usage over the full history

Sources, all read-only:

| Source | Volume |
|---|---|
| Claude transcripts `~/.claude/projects/**/*.jsonl` | 1,187 files |
| Claude prompt history `~/.claude/history.jsonl` | 699 prompts, from 2026-06-11 |
| Codex sessions `~/.codex/sessions/**` | 136 files |
| Major worker transcripts `~/.major/execution/**/*.jsonl` | 131 files |
| `~/.major/major.db` (`agent_runs`, `capability_selection` events) | 157 runs |
| `~/.major/learning/skill-routing-evidence.json` | 42 resolver rejections and misses |

The history covers **2026-06-11 to 2026-10-23 (134 days)**, not 45 days. A "use" is a `Skill` tool call, a read of the skill's `SKILL.md`, a slash command, or `major skill resolve --skill <id>`. Resolver selections and rejections are recorded separately and do not count as use. The counter is an extension of the earlier 45-day `count.py`.

| Group | Used / installed |
|---|---|
| Major internal (`skills/internal`) | 50 / 103 |
| Major external references (registry) | 5 / 23 |
| `~/.agents/skills` | 20 / 34 |
| GStack (Claude) | 1 / 56 (one `gstack-setup-gbrain` call on 2026-10-08) |
| Plugins (figma, ponytail, claude-security, claude-md-management, chrome-devtools-mcp) | 1 / 23 distinct names |
| claude.ai org-synced skills | 4 / 20 |
| Codex system skills | 2 / 4 |

The routing hook fires often but its hints are rarely followed. `ui-skills-root` was injected 172 times and followed once, `seo-os` 49/8 and `reference-engineering` 25/0. The hook was already repaired before this change. Measure it again after 30 days.

## 2. Root causes

1. **Hollow staged skills (24).** `api`, `architecture`, `auth-security`, `browser-release-qa`, `concurrency`, `cross-modal-review`, `database`, `debugging`, `dependency`, `deployment`, `frontend`, `incident`, `integration`, `migration`, `observability`, `performance`, `planning`, `review`, `security-audit`, `software-engineering`, `staged-quality-controls`, `tdd`, `verification` and `worktree` are the same template with only the name changed. A diff ratio against `debugging` is 0.78–1.0. They contain no procedure. Canonical routes still load some of them next to a skill that has real content, for example `debugging` with `root-cause-qa`.
2. **Resolver misses.**
   - `major` is a resolver stop word.
   - Words shorter than three letters (`ci`, `pr`) are dropped.
   - When a canonical route fires, it drops every other internal skill that scores below 100. This is why "debug CI" lost `ci-recovery` to the debug route.
3. **Writing over-selection.** Every writing route loaded all six gate skills at routing time, even before a draft existed. A LinkedIn post loaded 8–12 skills.
4. **Hyphen-joined triggers.** 71 of 126 registry `load` values were one hyphen-joined token, and `triggerConditions` repeated it. 57 are now plain phrases. The other 14 are metadata-only project-install references. Their `load` is part of installed-project identity checks, so changing it would break projects that already have them installed.
5. **Shared skills invisible to Major.** `reference-replica`, `engineering-by-reference` and `linkedin-gtm-and-content` live in `~/.agents/skills`, but the resolver never searched that directory.
6. **Copies instead of links.**
   - 6 byte-identical copies in `~/.claude/skills`.
   - 3 drifted copies of Major-owned skills: `website-design-qa` (two different documents), `reference-engineering` (v1.0.1 against repo v1.1.0) and `responsive-motion-systems`.
   - Codex-only vendor copies (`pdf`, `playwright`) in `~/.codex/skills`.
   - `~/.codex/skills/gstack`, which only links into the Claude GStack install.
   - Codex already reads `~/.agents/skills` natively, so `~/.codex/skills` only needs symlinks.

Examples of real prompts where a skill should have fired and did not (cause a):

- `ci-recovery`: 2026-10-08, "extra scrutiny of last commit addressing five CI failures". Several other "CI is red" prompts had the same result.
- `major-self-maintenance`: 2026-10-22, "do a critical review of Major, find weaknesses as an independent auditor".
- `logo-design`: 2026-10-04/05, Shelter logo work. The hint fired 4 times and was followed once.

## 3. Merge plan by cluster

A MERGE moves the unique content of the losing copy into the keeper. Nothing is dropped. Each merged trigger has a held-out eval case in `evals/skill-resolver-holdout/cases.json`.

| Cluster | Decision |
|---|---|
| **Writing (13 internal + `writing-guidelines` + `linkedin-gtm-and-content`)** | **Keep all 13.** Each is a distinct gate in `src/writing/routing.ts` with its own regression fixtures. **Fix:** routing now loads only `writing-os` and the genre specialist (plus `asd-ste100` and `academic-verify` where mandated). The six gate skills load at their gate. `writing-os` now has a gate → skill table. The receipt keeps the full gate list. LinkedIn now loads `writing-os`, `personal-brand-strategy` and `linkedin-gtm-and-content` (3, before 8). `writing-guidelines` stays a Vercel-context vendor reference. |
| **Review / QA** | Keep `root-cause-qa`, `lean-quality`, `exact-head-pr-review`, `website-design-qa`, `ci-recovery` and `webapp-testing` (reference). **Owner decision:** fold the hollow `debugging` → `root-cause-qa`, `verification` and `tdd` → `lean-quality`, `review` → `exact-head-pr-review`, and `browser-release-qa`, `staged-quality-controls` and `cross-modal-review` into `website-design-qa` and `lean-quality` as aliases. |
| **Design / taste** | Keep `design-direction-and-taste` (canonical art direction, 1,545 words), `emil-design-eng` (used 25 times), `interface-design`, `improve-ui`, `ui-skills-root`, `rapid-ui-prototype` and `exploratory-creative-dev`. **Owner decision:** the hollow `frontend`. The `emil-kowalski-complete` registry reference duplicates the installed `emil-design-eng`. Keep it as a project-install profile or drop it. |
| **Engineering doctrine** | Keep `simple-modular-code`, `engineering-design-doctrine`, `codebase-design`, `vertical-slice-delivery`, `mvp-speed-prioritisation` and `lean-graph-engineering`. They have distinct lenses and real content. **Owner decision:** fold the hollow `architecture` → `engineering-design-doctrine`, `planning` → `vertical-slice-delivery` and `software-engineering` → `simple-modular-code`, and decide on `api`, `database`, `concurrency`, `dependency`, `deployment`, `incident`, `integration`, `migration`, `observability`, `performance` (→ `performance-caching`) and `worktree`. |
| **Reference work** | `reference-engineering` (whole product, repo v1.1.0, kept), `engineering-by-reference` (behaviour or protocol) and `reference-replica` (visual) stay separate. The global routing rules already split them this way. **Fixed:** the last two are now in the Major catalog with routes. The `~/.agents` copy of `reference-engineering` was older and is replaced by a link. Its one unique sentence is already in the repo in a stricter form. |
| **Security** | Keep `security-threat-model` (reference) and the `claude-security` plugin. **Owner decision:** the hollow `security-audit` and `auth-security` have no internal keeper with real content. Fill them or alias them to `security-threat-model`. |
| **Duplicates** | `website-design-qa`: merged (agents-only routing phrases, phase evidence, validator commands and sign-off rule added as §18). `responsive-motion-systems`: merged (incident examples, zoom/`visualViewport` facts, `/__build` contract, DevTools full mode, native-zoom rule, per-bug invariant). `reference-engineering`: the repo version is the superset. `seo-os`: already correct. `grill-me` vs `grilling`: keep both, because `grill-me` is a one-line user-only alias. `pdf` ×4: Codex `pdf` moves to `~/.agents`, the org `pdf` serves Claude, `pdf-reporting-qa` has a different scope, and the `pdf` registry reference stays a project-install profile. `skill-creator` and `skill-resolver` org copies: owner decision. Figma triple: the plugin is canonical in-session, and the registry `figma-*` entries stay as project-install profiles. Ponytail: owner decision (see below). |

## 4. Changes in this PR

- `src/skills/resolver.ts`:
  - The new `shared-agents` source resolves only from `~/.agents/skills`.
  - Writing gate skills are deferred to their gate.
  - Weak generic matches are dropped when a writing route fires.
- `src/skills/canonical-routing.ts`: new routes for CI failure, Major self-change, forecasting, reverse engineering, visual reference, whole-product rebuild, website release or closeout, and LinkedIn.
- `src/writing/{types,routing}.ts`: `loadNow` and the gate-skill set. `skills` is unchanged, so `src/supervisor/runtime.ts` still receives the same writing route data.
- `guidance/skills.registry.json` (version 24): 3 shared entries, and 57 `load` values de-hyphenated. The generated catalog is updated to match.
- Skill bodies: `website-design-qa`, `responsive-motion-systems` (merged), `writing-os` (gate table), `learning-capture` (`major learn digest` and `major learn drain` from the learning-loop session; these commands ship with PR #103).
- `evals/skill-resolver-holdout/` and `tests/skill-resolver-holdout.test.ts`: held-out natural-language evals that the resolver never reads.
- `scripts/check-skill-drift.py`, with a self-test, is wired into `validate-major.sh`. It fails when a name resolves to more than one source, or when a Major-owned name does not link to this repo, the main checkout or `~/.major/skills/internal`. It skips when no host skill directories exist, as in CI.
- Independent read-only review (a separate agent) found 12 issues: false-positive routes, shared skills leaking on weak matches, and error handling in the host script. All 12 are fixed, and each false positive is now a must-not-route holdout case. Weak generic matches of two short common words no longer select a skill.
- `scripts/canonicalize-host-skills.sh`: dry run by default. `--apply` moves files to a timestamped archive and creates symlinks. It stops on any failed move and never links over an existing path. It is idempotent.
- GStack references are removed from `README.md`, `docs/architecture.md`, `docs/skills-catalog.md`, `guidance/*`, `templates/project/major-core.md` and `scripts/setup-major-knowledge-tools.sh`. That script no longer clones GStack. The validator now fails if it does.

## 5. Host state: apply once, after review

```bash
bash scripts/canonicalize-host-skills.sh           # dry run: prints every move
bash scripts/canonicalize-host-skills.sh --apply
python3 scripts/check-skill-drift.py               # must print "passed"
```

The links for Major-owned skills point at the main checkout (`~/Projects/project-baracks/skills/internal/<id>`). The merged content of `website-design-qa` and `responsive-motion-systems` reaches the hosts only after this PR merges and the main checkout pulls. Until then the hosts read the older repo version. The `~/.agents` copy that is replaced is kept in the archive.

| Host directory | Before | After apply |
|---|---|---|
| `~/.claude/skills` | 94 skills: 63 real directories, 31 links | 38 skills, 0 real directories |
| `~/.codex/skills` | 13: 3 real directories, 10 links | 12 links |
| `~/.agents/skills` | 37: 36 real directories, 1 link | 40: 36 real directories, 4 links into the repo |
| Major registry | 126 | 129 (+3 shared) |

## 6. Needs owner decision

1. **24 hollow staged skills.** Fold each into the keeper named in §3 as an alias, fill it with real procedure, or delete it. They are wired into the 18-role worker capability matrix, the reconciliation ledger and the validator count of 43 staged skills. An earlier owner-approved reconciliation created them, so this PR does not remove them.
2. **Ponytail copies in `~/.agents/skills` (6).** They differ from the plugin. For example, the `~/.agents` `ponytail-review` is a full correctness review, while the plugin version only checks complexity. Codex loads both. Keep them under new names, or drop them in favour of the plugin. The speed-token-mods session's script already removes the `~/.claude/skills/ponytail*` links.
3. **Per-skill `/major:*` commands (129).** They are generated for every registry entry and listed in every Claude session. The skill listing costs about 7.5k tokens per session (speed-token-mods finding). Several of these commands duplicate a native skill name (`seo-os`, `website-design-qa`, …).
4. **claude.ai org-synced skills.** There are 3 synced bundles with duplicate `pdf`, `docx`, `pptx`, `skill-creator` and `skill-resolver`, and `humanizer` overlaps `natural-writing-qa`. They are managed in claude.ai, not on this machine.
5. **`chrome-devtools-mcp` plugin.** It is disabled, but its 14 cached skills are still on disk.
6. **Vendor project-install references** that duplicate a host plugin or skill: `figma-use`, `figma-implement-design`, `figma-generate-design`, `pdf`, `skill-creator`, `vercel-deploy` (against `deploy-to-vercel`) and `emil-kowalski-complete`. Keep them as opt-in install profiles (current behaviour), or drop them from the registry together with `tests/skill-host-commands.test.ts`.
7. **Unused skills with too little history.** Most `~/.agents` skills were installed between 2026-10-05 and 2026-10-14. Measure again on 2026-12-01 with the same counter before any removal.

## 6a. Owner decisions applied (2026-10-23, follow-up to #106)

| # | Decision | What changed |
|---|---|---|
| 1 | Fold the hollow staged skills into keepers | 10 folded as aliases. The keeper also routes the old id, so `--skill debugging` still resolves: `debugging` → `root-cause-qa`; `verification`, `tdd`, `staged-quality-controls` → `lean-quality`; `review` → `exact-head-pr-review`; `browser-release-qa` → `website-design-qa`; `architecture` → `engineering-design-doctrine`; `planning` → `vertical-slice-delivery`; `software-engineering` → `simple-modular-code`; `performance` → `performance-caching`. The one-line routing example of each folded skill moved into its keeper's fixture and body. Capability matrix, reconciliation ledger (`MERGED_AS_ALIAS`), canonical routes and the staged count (43 → 33) are updated. Registry version 25, 93 internal skills. **No sensible keeper, kept unchanged:** `api`, `auth-security`, `concurrency`, `cross-modal-review` (has one real paragraph on independent review execution), `database`, `dependency`, `deployment`, `frontend`, `incident`, `integration`, `migration`, `observability`, `security-audit`, `worktree`. |
| 2 | Keep the `~/.agents` ponytail copies | No change. |
| 3 | Stop generating per-skill `/major:*` commands | Removed from the host sync (`src/skills/sync.ts`), the user-state installer (`scripts/stage-major-user-state.py`) and the project installer (`scripts/install-major-skills.sh`). Each host keeps one discovery command (`/major`). Installs now remove the old `major/` command directories. Skills stay reachable through native skill discovery and `major skill resolve --skill <id>`. Listing cost of the 129 commands: 17,793 characters (about 4.4k tokens) with full descriptions, or 3,414 characters (about 850 tokens) when Claude Code truncates them to names, as this session's listing did. After: one entry, about 40 tokens. |
| 4 | Prefer the claude.ai org versions of `pdf`, `docx`, `pptx`, `skill-creator`, `skill-resolver` | With item 3, Claude no longer lists `/major:pdf`, `/major:skill-creator` or `/major:skill-resolver`, so the org skills are the only ones Claude shows. `docx` and `pptx` had no Major copy. **Exception:** org skills do not reach Codex, so the Codex-only `~/.agents/skills/pdf` stays. Claude does not see it. **Owner action:** `humanizer` is an org-synced skill that overlaps `natural-writing-qa` (Major keeps `natural-writing-qa` and its `humanizer` alias). Disable `humanizer` in claude.ai. |
| 5 | Remove the disabled `chrome-devtools-mcp` plugin cache | Added to `scripts/canonicalize-host-skills.sh`. It archives the 347 MB cache and runs `claude plugin uninstall`. |
| 6 | Keep vendor project-install references | No change. |
| 7 | Re-measure recent skills | **Re-measure on 2026-12-01.** Run the same counter over the full history for the `~/.agents` skills installed between 2026-10-05 and 2026-10-14 (`anatomy`, `hairline-create`, `logo-design`, `create-design-md`, `graphify`, `typesafe-ai`, `opencli-autofix`, `react-doctor`, `shadcn`, `web-quality-audit`, `expose-local`). Remove a skill only if it is still unused and the history contains no task where it should have fired. A `major learn digest` item was not added. The digest has no dated-reminder input, so adding one is more than a few lines. |

## 7. Per-skill classification

Cause: **a** needed but never fired · **b** duplicate or overlap · **c** not needed in the observed history · **d** used. "Uses" counts real loads over 134 days.

| Skill | Homes | Uses | Last | Cause | Decision |
|---|---|---|---|---|---|
| `_gstack-command` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `a11y-debugging` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `academic-verify` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `academic-writing` | reg:internal | 3 | 2026-10-21 | d | KEEP |
| `agent-reach` | agents claude | 42 | 2026-10-22 | d | KEEP |
| `algorithmic-art` | reg:github:anthropics/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `analytics-with-shaper` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `anatomy` | agents claude codex | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `api` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `ar-ap-invoice` | reg:internal | 1 | 2026-10-22 | d | KEEP |
| `architecture` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `asd-ste100` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `auth-security` | reg:internal | 1 | 2026-10-20 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `behavior-reward-system` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `brand-guidelines` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `brand-strategy` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `break-ui` | agents claude | 7 | 2026-10-20 | d | KEEP |
| `browser-release-qa` | reg:internal | 7 | 2026-10-20 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `built-in-browser` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `candidate-assessment-graph` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `canvas-design` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `capability-freshness` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `chief-of-staff-boundary` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `chrome-browser` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `chrome-devtools` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `chrome-devtools-cli` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `ci-recovery` | reg:internal | 0 | - | a | FIXED: CI failures (e.g. 2026-10-08 "five CI failures") routed to debugging; new CI route |
| `claude-md-improver` | plugin:claude-md-management | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `claude-security` | plugin:claude-security | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `codebase-design` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `competitive-product-audit` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `computer-use` | claude-org-synced | 4 | 2026-10-06 | d | KEEP (claude.ai org skill) |
| `concept-synthesis` | reg:internal | 1 | 2026-10-21 | d | KEEP |
| `concurrency` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `controller-bookkeeping` | reg:internal | 0 | 2026-09-02 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `cookie-debugging` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `cost-control` | reg:internal | 1 | 2026-10-22 | d | KEEP |
| `create-design-md` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `cross-modal-review` | reg:internal | 1 | 2026-10-21 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `data-learning-loop` | reg:internal | 0 | 2026-08-24 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `database` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `debug-optimize-lcp` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `debugging` | reg:internal | 1 | 2026-10-18 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `deep-research` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `dependency` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `deploy-to-vercel` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `deployment` | reg:internal | 3 | 2026-10-18 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `design-direction-and-taste` | reg:internal | 18 | 2026-10-21 | d | KEEP |
| `deterministic-accounting-boundary` | reg:internal | 1 | 2026-10-21 | d | KEEP |
| `dev-server-management` | reg:internal | 0 | 2026-09-03 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `direct-response-writing` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `docs` | claude-org-synced | 2 | - | d | KEEP (claude.ai org skill) |
| `docx` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `domain-modeling` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `emil-design-eng` | agents claude | 25 | 2026-10-21 | d | KEEP |
| `emil-kowalski-complete` | reg:github:emilkowalski/skills | 1 | 2026-09-23 | d | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `engineering-by-reference` | agents claude | 8 | 2026-10-21 | d | FIXED: not in Major catalog; added as shared entry + reverse-engineering route |
| `engineering-design-doctrine` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `exact-head-pr-review` | reg:internal | 9 | 2026-10-21 | d | KEEP |
| `executive-assistant` | reg:internal | 1 | 2026-10-22 | d | KEEP |
| `exploratory-creative-dev` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `expose-local` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `figma-code-connect` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-code-workflows` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-create-new-file` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-design-to-code` | plugin:figma | 12 | 2026-10-06 | d | KEEP |
| `figma-generate-design` | plugin:figma reg:github:openai/skills | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-generate-diagram` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-generate-library` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-generative-plugins` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-implement-design` | reg:github:openai/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `figma-implement-motion` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-shaders` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-spec` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-swiftui` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-use` | plugin:figma reg:github:openai/skills | 7 | 2026-10-21 | d | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `figma-use-figjam` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-use-motion` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `figma-use-slides` | plugin:figma | 0 | - | c | KEEP: Figma plugin skills (plugin-managed); Figma MCP needs auth before use |
| `fpa-forecasting-extrapolation` | reg:internal | 0 | - | a | FIXED: "financial model"/"forecast" routed to valuation only; new forecasting route |
| `frontend` | reg:internal | 2 | 2026-10-20 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `frontend-design` | reg:github:anthropics/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `gaussian-splatting-spatial-reconstruction` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `google-workspace` | claude-org-synced | 2 | - | d | KEEP (claude.ai org skill) |
| `graph-engineering` | reg:github:codejunkie99/graph-engineering | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `graphify` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `grill-me` | agents claude | 1 | 2026-10-22 | d | KEEP: one-line user-only alias of grilling (no model routing) |
| `grilling` | agents claude | 18 | 2026-10-22 | d | KEEP |
| `gstack` | claude codex | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-autoplan` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-benchmark` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-benchmark-models` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-browse` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-canary` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-careful` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-codex` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-connect-chrome` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-context-restore` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-context-save` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-cso` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-design-consultation` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-design-html` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-design-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-design-shotgun` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-devex-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-diagram` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-document-generate` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-document-release` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-freeze` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-guard` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-health` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-investigate` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ios-clean` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ios-design-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ios-fix` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ios-qa` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ios-sync` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-land-and-deploy` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-landing-report` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-learn` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-make-pdf` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-office-hours` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-open-gstack-browser` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-pair-agent` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-plan-ceo-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-plan-design-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-plan-devex-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-plan-eng-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-plan-tune` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-qa` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-qa-only` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-retro` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-review` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-scrape` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-setup-browser-cookies` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-setup-deploy` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-setup-gbrain` | claude | 1 | 2026-10-08 | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-ship` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-skillify` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-spec` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-sync-gbrain` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-unfreeze` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `gstack-upgrade` | claude | 0 | - | c | REMOVED (owner-approved gstack uninstall; archived) |
| `hairline-create` | agents claude codex | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `human-blocker-orchestration` | reg:internal | 29 | 2026-10-21 | d | KEEP |
| `humanizer` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `idea-lineage` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `imagegen` | codex-system | 10 | 2026-10-21 | d | KEEP |
| `import-memory` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `improve-ui` | agents claude | 4 | 2026-10-21 | d | KEEP |
| `incident` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `integration` | reg:internal | 1 | 2026-10-22 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `interface-design` | agents claude | 4 | 2026-10-20 | d | KEEP |
| `jev-workflows` | agents claude codex | 2 | 2026-10-14 | d | KEEP |
| `knowledge-ingest` | reg:internal | 1 | 2026-10-22 | d | KEEP |
| `knowledge-work` | reg:internal | 11 | 2026-10-21 | d | KEEP |
| `lean-graph-engineering` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `lean-quality` | reg:internal | 7 | 2026-10-21 | d | KEEP |
| `learning-capture` | reg:internal | 3 | 2026-10-22 | d | KEEP |
| `legacy-cleanup` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `linkedin-gtm-and-content` | agents claude codex | 0 | - | a | FIXED: not in Major catalog; added to the LinkedIn route |
| `logo-design` | agents claude codex | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `major-self-maintenance` | reg:internal | 17 | 2026-10-22 | d | FIXED: "audit Major" missed: `major` is a resolver stop word; new self-change route |
| `mcp-builder` | reg:github:anthropics/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `mcp-integration-ops` | reg:internal | 9 | 2026-10-18 | d | KEEP |
| `memory-leak-debugging` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `migration` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `mobile-native` | agents claude | 11 | 2026-10-21 | d | KEEP |
| `morning` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `mvp-speed-prioritisation` | reg:internal | 0 | 2026-08-29 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `natural-writing-qa` | reg:internal | 6 | 2026-10-21 | d | KEEP: writing gate; now loads at its gate, not up front |
| `nontechnical-ux` | reg:internal | 0 | 2026-08-24 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `observability` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `open-source-leverage` | reg:internal | 3 | 2026-10-22 | d | KEEP |
| `openai-docs` | codex-system | 2 | 2026-10-21 | d | KEEP |
| `opencli-autofix` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `opencli-browser` | agents claude | 1 | 2026-10-18 | d | KEEP |
| `opencli-usage` | agents claude | 1 | 2026-10-18 | d | KEEP |
| `operations-improvement-core` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `pdf` | claude-org-synced codex reg:github:openai/skills | 8 | 2026-10-22 | d | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `pdf-reporting-qa` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `performance` | reg:internal | 0 | 2026-09-03 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `performance-caching` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `personal-brand-strategy` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `planning` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `playwright` | codex reg:github:openai/skills | 4 | 2026-10-20 | d | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `ponytail` | agents claude plugin:ponytail | 9 | 2026-10-22 | d | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `ponytail-audit` | agents claude plugin:ponytail | 1 | 2026-10-20 | d | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `ponytail-debt` | agents claude plugin:ponytail | 0 | - | b | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `ponytail-gain` | agents claude plugin:ponytail | 0 | - | b | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `ponytail-help` | agents claude plugin:ponytail | 1 | 2026-10-21 | d | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `ponytail-review` | agents claude plugin:ponytail | 18 | 2026-10-22 | d | OWNER DECISION: ~/.agents copy is owner-customised and differs from the ponytail plugin (both hosts load both) |
| `pptx` | claude-org-synced | 3 | - | d | KEEP (claude.ai org skill) |
| `presentation-storylining` | reg:internal | 4 | 2026-10-19 | d | KEEP |
| `prior-art-discovery` | reg:internal | 15 | 2026-10-22 | d | KEEP |
| `product-management-core` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `project-context-integrity` | reg:internal | 7 | 2026-10-18 | d | KEEP |
| `project-start` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `prose-craft` | reg:internal | 1 | 2026-10-21 | d | KEEP: writing gate; now loads at its gate, not up front |
| `prose-lint` | reg:internal | 4 | 2026-10-21 | d | KEEP: writing gate; now loads at its gate, not up front |
| `rapid-ui-prototype` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `react-doctor` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `reconciliation-close-statements` | reg:internal | 0 | 2026-09-02 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `reference-engineering` | agents claude codex reg:internal | 2 | 2026-10-22 | d | FIXED: drifted ~/.agents v1.0.1 copy; repo v1.1.0 kept |
| `reference-replica` | agents claude | 14 | 2026-10-21 | d | FIXED: not in Major catalog; added as shared entry + visual-reference route |
| `remote-first-web-development` | reg:internal | 24 | 2026-10-21 | d | KEEP |
| `research-compendium` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `responsive-motion-systems` | claude reg:internal | 40 | 2026-10-22 | d | FIXED: drifted ~/.claude copy; merged |
| `resume-rewriter` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `retrieval-reflex` | agents claude codex | 3 | 2026-10-22 | d | KEEP |
| `reusable-asset-discovery` | reg:internal | 0 | 2026-08-29 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `reverse-engineer-anything` | agents claude | 3 | 2026-10-21 | d | KEEP |
| `review` | reg:internal | 8 | 2026-10-21 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `review-agent` | codex-system | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `root-cause-qa` | reg:internal | 3 | 2026-10-21 | d | KEEP |
| `sales-commercial-core` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `sector-outreach` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `security-audit` | reg:internal | 2 | 2026-10-21 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `security-threat-model` | reg:github:openai/skills | 0 | 2026-09-22 | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `seo-os` | agents claude codex reg:internal | 10 | 2026-10-21 | d | KEEP |
| `shadcn` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `simple-modular-code` | reg:internal | 3 | 2026-10-21 | d | KEEP |
| `skill-creator` | claude-org-synced codex-system reg:github:anthropics/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `skill-harvest` | reg:internal | 1 | 2026-10-22 | d | KEEP |
| `skill-installer` | codex-system | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `skill-resolver` | claude-org-synced reg:internal | 0 | 2026-08-29 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `skillify` | reg:internal | 3 | 2026-10-22 | d | KEEP |
| `software-engineering` | reg:internal | 2 | 2026-10-21 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `source-adapter-engineering` | reg:internal | 0 | 2026-08-23 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `source-ingestion` | reg:internal | 12 | 2026-10-21 | d | KEEP |
| `staged-quality-controls` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `strategic-reading` | reg:internal | 3 | 2026-10-21 | d | KEEP |
| `surface-talent-deck` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `tdd` | reg:internal | 0 | 2026-09-02 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `technical-writing` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `theme-factory` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `tools-as-code` | reg:internal | 1 | 2026-10-21 | d | KEEP |
| `troubleshooting` | plugin:chrome-devtools-mcp | 0 | - | c | OWNER DECISION: plugin is disabled; cached skills never load; uninstall the plugin cache |
| `typesafe-ai` | agents claude codex | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `ui-skills-root` | agents claude | 1 | 2026-10-20 | d | KEEP |
| `valuation-investment-ma` | reg:internal | 0 | - | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `vercel-cli-with-tokens` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `vercel-composition-patterns` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `vercel-deploy` | reg:github:openai/skills | 0 | - | b | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `vercel-optimize` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `vercel-react-best-practices` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `vercel-react-native-skills` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `vercel-react-view-transitions` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `verification` | reg:internal | 0 | - | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `verify-before-trust` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |
| `vertical-slice-delivery` | reg:internal | 0 | 2026-09-02 | c | KEEP: domain/role coverage (worker capability matrix); no matching task in history; re-measure |
| `voice-fingerprint` | reg:internal | 6 | 2026-10-22 | d | KEEP: writing gate; now loads at its gate, not up front |
| `web-design-guidelines` | reg:vercel-agent-skills | 0 | 2026-09-03 | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `web-quality-audit` | agents claude | 0 | - | c | KEEP: installed 2026-10-05..14, too new to judge; re-measure 2026-12-01 |
| `webapp-testing` | reg:github:anthropics/skills | 1 | 2026-10-20 | d | KEEP as opt-in project-install profile; host plugin/skill is canonical in-session (OWNER DECISION to drop) |
| `website-design-qa` | agents claude codex reg:internal | 42 | 2026-10-22 | d | FIXED: two drifted copies; merged; release/closeout route added |
| `workspace-lifecycle-management` | reg:internal | 9 | 2026-10-21 | d | KEEP |
| `worktree` | reg:internal | 1 | 2026-10-22 | b | OWNER DECISION: hollow staged template (no procedure content); fold into keeper as alias |
| `writing-evaluator` | reg:internal | 5 | 2026-10-21 | d | KEEP: writing gate; now loads at its gate, not up front |
| `writing-guidelines` | reg:vercel-agent-skills | 0 | - | c | KEEP: live vendor ref, only routes with Vercel/Next/React context; re-measure |
| `writing-os` | reg:internal | 16 | 2026-10-21 | d | KEEP |
| `writing-red-team` | reg:internal | 6 | 2026-10-21 | d | KEEP: writing gate; now loads at its gate, not up front |
| `xlsx` | claude-org-synced | 0 | - | c | OWNER DECISION (claude.ai org skills, not local) |

## Addendum: AIforUI `emil-*` specialists (registry v26)

- 28 skills installed by `npx @aiforui/install` are registered as `shared-agents` entries (canonical home `~/.agents/skills`, hosts symlink). No content is copied into this repo; the installer token is not stored anywhere.
- `emil-kowalski-complete` stays an opt-in project-install bundle of the open-source repo. It does not contain these 28, so the entries are added next to it, not merged into it.
- `src/skills/canonical-routing.ts` appends an `emil-craft` route after all existing routes, so `design-direction-and-taste`, `website-design-qa` and `responsive-motion-systems` keep their positions. Scroll-motion prompts (GSAP, ScrollTrigger, sticky, parallax) get no `emil-animations`.
- Evidence: `tests/emil-skill-routing.test.ts` and `evals/skill-resolver/emil-*.json`.
