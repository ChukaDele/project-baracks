# Skill activation and knowledge retrieval audit

Status date: 2026-10-13. This audit separates **installed**, **discoverable**, **selected**, **loaded**, **executed**, and **functionally verified**.

## Major source registry

The canonical Major registry currently declares **103 internal skills** and **23 external skill references**. Every internal entry has a `SKILL.md`; all 126 registry entries have resolver fixture JSON. The standard resolver tests run positive and negative examples from those fixtures. Passing fixtures does **not** establish that a third-party plugin has been installed in an individual project or that its credentials, integrations or runtime actions work.

The existing `skill-resolver` and `mcp-integration-ops` workflows remain the authoritative paths. Do not register duplicate copies of Figma, Reference Engineering, REA or UI skills to fix a host-discovery problem.

## Mac status

A previous live Mac filesystem audit counted 27 shared skill directories, 84 Claude-visible skill directories, four Codex-visible skill directories and 70 GBrain skill directories. Six Ponytail broken links and two specialist discovery links were repaired, and a local static audit passed. Counts are historical snapshots, not current or per-skill activation proof. At the time of this review Desktop Commander was **offline**, so none of those host paths could be freshly audited or synchronized.

## Knowledge architecture and automatic retrieval

The source-of-truth hierarchy is the **maintained Notion Knowledge Library** (bank → Knowledge Piece), followed by scoped GBrain patterns/decisions, ContextBolt original saves when needed, and Eagle for visual references. The owner maintains an additional raw X/Instagram corpus, but the system must not indiscriminately load or disclose that corpus.

Notion and ContextBolt returned real reads through the ChatGPT connectors during this audit. Those reads do **not** establish Notion/ContextBolt access inside the Mac's Codex, Claude or Major host processes.

The canonical source-routing guidance now defines task-relevant, bounded read-first retrieval; evidence attribution; freshness rechecks; privacy boundaries; safe fallback when unavailable; and explicit authorization for write-back. Do not create another automatic agent router for this.

## Verified connector setup (each host requires its own OAuth)

Inspect existing MCP registrations first and avoid duplicate names. Use provider-hosted Streamable HTTP. The ContextBolt shared URL is nonsecret; personal-token URLs must stay out of repositories.

Claude Code user-level MCP connections:

```bash
claude mcp list
claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp
claude mcp add --scope user --transport http contextbolt-bookmarks https://api.contextbolt.app/mcp
```

Codex CLI and desktop shared MCP configuration:

```bash
codex mcp list
codex mcp add notion --url https://mcp.notion.com/mcp
codex mcp add contextbolt-bookmarks --url https://api.contextbolt.app/mcp
codex mcp login notion
codex mcp login contextbolt-bookmarks
```

Complete Notion and ContextBolt browser OAuth separately in each host. In Claude Code use `/mcp`. Notion may grant the connector access to the entire authorized workspace, so limit retrieval to search/read tools and require explicit approval before writes. Do not reuse ChatGPT session credentials, email codes or private token URLs.

Confirm real Notion search/fetch of a maintained Knowledge Piece and ContextBolt bookmark search in the *same local host*. A listed server does not establish authentication or permission.
## Local acceptance work once Mac is online

1. Sync Major's latest green main source with the supported `major skill sync` path; check `major skill audit --strict`.
2. Run the already-installed local audit `python3 ~/.agents/verify-skill-activation.py`. Reconcile every shared, Claude, Codex, GBrain and Major skill directory, preserving deliberate aliases and checking file hashes.
3. Execute positive and near-neighbour negative route cases on the installed hosts; inspect invocation traces to prove the selected `SKILL.md` body was read. File existence alone is insufficient.
4. Verify a Notion Knowledge Piece **search and fetch**, a ContextBolt **bookmark search**, and an authorized GBrain **scoped retrieval** from the *same local agent runtime*. Confirm authenticated and permissioned operation without logging tokens.
5. Test a real research/design task that automatically pulls a relevant maintained piece **without the user explicitly saying 'use the library'**. Test an unrelated narrow task that avoids retrieval. Keep any client-sensitive material inside its authorized project.
6. Record failures separately as missing installation, missing tool exposure, missing authentication/permissions, wrong skill selection or failed execution. Never report all skills as active based only on one successful example.

**Completion requires execution evidence, not just registry membership.** The Mac connector must be online before the local check and synchronization can be completed.
