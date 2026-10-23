# Speed and tokens

How much fixed context each Claude Code and Codex session and subagent carries, what this change removed, and the levers the owner controls.

Tokens are estimated as characters ÷ 4. Source: a read-only scan of Claude Code transcripts in `~/.claude/projects` (14 days to 2026-10-23: 95 main sessions, 60 subagent transcripts) and Codex logs in `~/.codex/sessions` (136 sessions).

## Always-on injections: before and after

| Injection | Where | Before | After | How |
| --- | --- | --- | --- | --- |
| Ponytail ruleset | SessionStart, every session | 5,201 chars, ~1,300 t (95/95 sessions) | 0 | `defaultMode: "off"` in `~/.config/ponytail/config.json`; `/ponytail lite` turns it on for one session |
| Ponytail ruleset | SubagentStart, every subagent | 5,313 chars, ~1,330 t (60/60 subagents) | 0 | Same: the subagent hook injects only when a mode is active. `PONYTAIL_SUBAGENT_MATCHER="(?!)"` blocks it even then |
| Major banner, project-baracks | SessionStart | installed: 34–36 KB, ~8,700 t | 4.4 KB, ~1,100 t | `src/context/session-context.ts` (this PR) plus reinstall |
| Major banner, other projects | SessionStart | installed: 12.8–14.1 KB | under 2.5 KB with no goal or learnings | Same |
| `~/.claude/major-global.md` | every session and subagent | 26,753 chars, ~6,690 t | 13,378 chars, ~3,340 t | Already on `main` (PR #99). Installed copy is from 2026-10-14; reinstall applies it |
| Codex `AGENTS.md` Major block | every Codex session | 26,782 chars | ~13,400 chars | Same reinstall |
| `~/.claude/CLAUDE.md` | every session and subagent | 5,580 chars, ~1,400 t | unchanged | Owner file |
| `~/.claude/rules/karpathy-coding.md` | every session and subagent | 2,344 chars, ~590 t | unchanged | Owner file; overlaps the Major simplicity rules |
| Skill listing (280 skills) | every session and subagent | 29,820 chars, ~7,460 t | unchanged here | Owned by the skills session. 6 duplicate ponytail entries go when the `~/.claude/skills/ponytail*` symlinks are removed |
| Skill-dispatch hint | UserPromptSubmit, matching prompts | 363 chars, ~90 t | unchanged | Fixed earlier in `~/.agents/hooks/skill-dispatch.py` |
| GBrain retrieval hint | UserPromptSubmit, project-named prompts | 553 chars, ~140 t | unchanged | Small and conditional |
| Explore subagent rules | every Explore subagent | CLAUDE.md stack, ~8,700 t (~5,300 t after reinstall), main model (Opus 1M) | 0 t of rules, Sonnet at low effort | `adapters/claude-agents/Explore.md`, installed to `~/.claude/agents/Explore.md` |

### Totals, Claude Code

| | Before | After (this PR + reinstall + local config) |
| --- | --- | --- |
| Session start, project-baracks (ponytail + banner + rules) | ~1,300 + ~8,700 + ~8,670 = ~18,700 t | 0 + ~1,100 + ~5,330 = ~6,400 t |
| Each general-purpose subagent (ponytail + rules) | ~1,330 + ~8,670 = ~10,000 t | ~5,330 t |
| Each Explore subagent | ~10,000 t on the main model | 0 t of rules, Sonnet/low |

These totals leave out the skill listing (~7,460 t in each session and subagent), because that work is in a different session.

### The banner was being cut off

Claude Code swaps hook output larger than about 10,000 characters for a ~2 KB preview and a file path. The model sees only the preview. All 30 sessions with a banner over that size (every project-baracks session, most JSS ones) lost the SESSION CONTRACT, which comes last. Codex caps hook context at `additionalContextLimit: 8000`, so Codex lost it too. The old banner cost tokens and also hid the part that matters. The new banner stays well under both limits, and the contract is short.

What the banner keeps: project, policy, foreground authority, the active goal and its id, live worker, last summary (clipped to 300 chars), inactive-goal counts, worker and Codex capacity, and resources on one line. It shows learnings and resolved skills only when they exist. Stable rules (skill resolver paths, design-direction-and-taste, project integrity, MCP proof, website QA) live in the cached rules file `guidance/global-worker-rules.md`. REVIEW-DUE learnings now go to the weekly learning batch (`major learn digest`), so they no longer hold a task open.

## Prompt caching

The scan found no per-prompt text placed before stable text:

- Claude Code renders CLAUDE.md, rules and memory first, then the first user turn. SessionStart output is appended after them.
- UserPromptSubmit hints (skill-dispatch, GBrain) are appended to their own turn, so earlier turns stay cached.
- MCP servers that connect late (gbrain, notion) add deferred-tool and instruction deltas as new messages. They do not rewrite the tool block.
- The banner's volatile fields (memory %, capacity, goal summary) are injected once, at session start.

What does break the cache: editing CLAUDE.md, `major-global.md` or the rules files breaks it once for every new session after the edit. A reinstall does the same. So batch rule edits, and do not reinstall rules in the middle of a session.

## Repository context without re-reading: Graphify

When a repo contains `graphify-out/graph.json`, Major's worker prompt adds a REPOSITORY GRAPH block (`src/context/graphify.ts`). It tells workers to use `graphify query/path/explain/affected` before broad reads. The custom Explore agent does the same. Repos without a graph get nothing.

Build the graph once per repository, from its root:

```bash
graphify update .
```

`update` uses AST extraction only. It makes no LLM calls and costs nothing. Do not use `graphify extract` or `label` unless you approve the spend: they call a paid LLM backend. Add `graphify-out/` to the repo's `.gitignore`, or commit it on purpose. Refresh it after large changes with `graphify update .`, or keep it current with `graphify watch .`. Workers are told not to rebuild it, because a mid-dispatch write would change the source-tree digest.

## Subagent model and effort

Claude Code subagent frontmatter supports `model` (`haiku`, `sonnet`, `opus`, `fable`, a full id, or `inherit`), `effort` (`low` to `max`) and `omitClaudeMd`. Resolution order: the per-call model, then frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model. The built-in Explore agent inherits the main model. A user agent named `Explore` overrides it.

- Applied (through the Major installer): `Explore` with `model: sonnet`, `effort: low`, `omitClaudeMd: true`, and no edit tools.
- Not applied: `CLAUDE_CODE_SUBAGENT_MODEL`. It would change every custom subagent, including reviewers. Per-agent frontmatter is safer.
- Major's own workers already pick class and effort per task (PR #98, `guidance/model-routing.md`).
- Codex: `~/.codex/config.toml` sets `model_reasoning_effort = "high"`, `model_verbosity = "high"` and `model_reasoning_summary = "detailed"` for every session. Proposed profile for read-only exploration:

  ```toml
  [profiles.explore]
  model_reasoning_effort = "low"
  model_verbosity = "low"
  model_reasoning_summary = "concise"
  ```

  Use it with `codex --profile explore`. Lowering `model_verbosity` and the reasoning summary to `medium`/`concise` globally also saves output tokens on every turn.

## Owner levers

| Lever | Effect | How |
| --- | --- | --- |
| Fast mode | Same Opus model with faster output; costs more per token | `/fast` (toggle) |
| Effort | Fewer thinking tokens on routine turns | `/effort low\|medium\|high`, or the model picker. `CLAUDE_CODE_EFFORT_LEVEL` overrides subagent frontmatter, so leave it unset |
| Model per subagent | Cheap models for search, strong models for review | `model:` / `effort:` in `~/.claude/agents/*.md` |
| 1M context | `opus[1m]` makes long sessions cost more per turn | Use plain `opus` unless a task needs 1M |
| `/compact` | Shrinks a long conversation; the next turn re-caches | Run it at a natural break, with a focus: `/compact keep the PR state and open findings` |
| `/clear` | Resets context between unrelated tasks | Cheaper than compacting unrelated history |
| ccusage status line | Shows session cost and burn rate live | `"statusLine": {"type": "command", "command": "npx -y ccusage@latest statusline"}` in `~/.claude/settings.json`, or run `/statusline` |
| Skill count | ~7,460 t per session and subagent for 280 skills | Disable unused plugins and skill bundles (skills session) |

## Measuring again

`python3 -I scripts/measure-context-injections.py 14` is read-only. It sums hook output, instruction files and the skill listing per session and per subagent from the transcript `attachment` records. Rerun it after the reinstall, and after a week of normal use, to confirm the "after" column.
