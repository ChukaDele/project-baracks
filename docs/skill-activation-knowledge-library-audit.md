# Skill activation and knowledge retrieval audit

Status date: 2026-10-13. This audit separates **installed**, **discoverable**, **selected**, **loaded**, **executed**, and **functionally verified**.

## Major source registry

The canonical Major registry currently declares **103 internal skills** and **23 external skill references**. Every internal entry has a `SKILL.md`; all 126 registry entries have resolver fixture JSON. The standard resolver tests run positive and negative examples from those fixtures. Passing fixtures does **not** establish that a third-party plugin has been installed in an individual project or that its credentials, integrations or runtime actions work.

The existing `skill-resolver` and `mcp-integration-ops` workflows remain the authoritative paths. Do not register duplicate copies of Figma, Reference Engineering, REA or UI skills to fix a host-discovery problem.

## Mac status

A previous live Mac filesystem audit counted 27 shared skill directories, 84 Claude-visible skill directories, four Codex-visible skill directories and 70 GBrain skill directories. Six Ponytail broken links and two specialist discovery links were repaired, and a local static audit passed. Counts are historical snapshots, not current or per-skill activation proof. At the time of this review Desktop Commander was **offline**, so none of those host paths could be freshly audited or synchronized.

## Knowledge architecture and automatic retrieval

Notion is the **sole automatic cross-topic curated knowledge source**. Agents should select the relevant Knowledge Bank → maintained Knowledge Piece and use the current project files/GBrain only for authorized project state. The user-owned ContextBolt bookmark collection and raw X/Instagram corpus are **not fully triaged** and must not be pulled automatically, cited as maintained synthesis, or used as fallback when Notion has no result.

ContextBolt remains available solely for explicit ingestion/review/triage/backfill requests. Evidence found there is unverified until processed into the relevant maintained Notion Knowledge Piece, with contradictions and provenance preserved.

The ChatGPT Notion connector returned real maintained Knowledge Pieces in this audit. This does not establish that separate Codex, Claude or Major runtimes have authenticated Notion access. Their individual runtime read must be independently verified.

## Local Notion connector setup

Only **Notion** is required for automatic curated-knowledge retrieval. Inspect existing MCP connections and avoid duplicates. Connect and authorize Notion separately in Claude Code and Codex using their supported user-level OAuth flows.

Claude Code:

```bash
claude mcp list
claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp
```

Codex:

```bash
codex mcp list
codex mcp add notion --url https://mcp.notion.com/mcp
codex mcp login notion
```

In Claude Code, use `/mcp` to complete Notion sign-in. Notion may expose the authorized workspace; read only the relevant Knowledge Pieces and do not copy private content into shared logs. A server registration alone does not prove an authenticated search or full-page read.

**ContextBolt: optional for explicit triage only.** Existing MCP registrations may remain available, but they must not be queried during ordinary research or used when Notion has no result. Authorize/use the separate ContextBolt connector only for user-requested source mining, review or triage. Its saved content is **not fully triaged** and is not maintained synthesis.

The local Codex Notion smoke test on 14 October 2026 observed real Notion search and page-fetch calls with no ContextBolt calls. That is a task-specific read proof, not a guarantee that all agents or contexts are authenticated.

## Local acceptance work once Mac is online

1. Sync Major's latest green main source with the supported `major skill sync` path; check `major skill audit --strict`.
2. Run the already-installed local audit `python3 ~/.agents/verify-skill-activation.py`. Reconcile every shared, Claude, Codex, GBrain and Major skill directory, preserving deliberate aliases and checking file hashes.
3. Execute positive and near-neighbour negative route cases on the installed hosts; inspect invocation traces to prove the selected `SKILL.md` body was read. File existence alone is insufficient.
4. Verify a Notion Knowledge Piece **search and fetch** plus an authorized project-scoped GBrain read from the *same local agent runtime*. Do not retrieve ContextBolt saves as a substitute or as a routine smoke test; test ContextBolt only under an explicit triage task.
5. Test a real research/design task that automatically pulls a relevant maintained piece **without the user explicitly saying 'use the library'**. Test an unrelated narrow task that avoids retrieval. Keep any client-sensitive material inside its authorized project.
6. Record failures separately as missing installation, missing tool exposure, missing authentication/permissions, wrong skill selection or failed execution. Never report all skills as active based only on one successful example.

**Completion requires execution evidence, not just registry membership.** The Mac connector must be online before the local check and synchronization can be completed.
