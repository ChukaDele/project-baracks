---
name: mcp-integration-ops
description: Use for MCP servers, plugins, connectors, provider tools, OAuth-backed integrations, tool exposure failures, reconnects, missing capabilities or claims that an integration is installed/connected. Distinguish installed, configured, exposed, authenticated, permissioned and proven by a real operation; diagnose the earliest broken boundary and use the native integration before browser workarounds.
---

# MCP & Integration Operations

Integrations fail in layers. Do not collapse them into a single `connected` state.

## State model

Treat these as separate facts:

1. **Installed** — package/server/plugin exists.
2. **Configured** — host has the expected config/registration.
3. **Exposed** — the current agent host can actually see the tools/resources.
4. **Authenticated** — provider identity/session is valid.
5. **Permissioned** — required scopes/roles are granted.
6. **Operational** — a representative read/write call succeeds.
7. **Integrated** — the real project workflow consumes the operation correctly.

Never infer a later state from an earlier one.

## Default route

1. Identify the intended capability and owning provider.
2. Inspect the existing integration before installing another copy.
3. Prefer the provider's native connector/API/MCP over browser automation.
4. Verify host exposure in the actual Claude/Codex/Cursor/Antigravity session.
5. If authentication or consent is required, use `human-blocker-orchestration` and continue independent work.
6. Verify exact scopes/permissions.
7. Run the smallest representative operation.
8. Verify persisted/provider state, not only local config.
9. Record the proven integration contract in project docs when it is project-specific.

## Failure routing

When a call fails, identify the earliest broken layer:

- binary/package missing → install/repair only the canonical implementation;
- config exists but tools absent → host registration/restart/session exposure issue;
- tools visible but auth fails → authentication/session issue;
- auth succeeds but call forbidden → scope/role issue;
- provider call succeeds but product does not change → project adapter/workflow issue;
- repeated materially identical failure → change tool/route rather than retrying the same command.

Do not jump to browser scraping because an MCP call failed if a native integration should work and the actual failure is authentication/configuration.

## Verification

A screenshot of settings, a config file, `mcp list`, or an installed package is not enough. Prefer a representative operation with provider evidence.

Examples:

- GitHub: read a real repo/PR or perform an authorized test mutation.
- Google Calendar: fetch a real event/free-busy result before claiming calendar access.
- Gmail: fetch a real thread before claiming inbox access.
- Figma: read a real file/node before claiming Figma is usable.
- Recruitly/CRM: read/write a permitted non-destructive record and verify the provider state.

## Duplication and cleanup

Do not install a second MCP/server/plugin to work around a configuration issue unless the first implementation is intentionally being replaced. After replacement proves itself, remove obsolete config and stale docs under `legacy-cleanup`.

## Security and data

Never print or commit secrets/tokens. Client/PII data remains project-local. Use minimum required scopes, but do not turn ordinary already-authorized integration work into repeated approval ceremony.

## Resolver examples

### Should trigger

- "The MCP server is installed but Claude cannot see the tools."
- "Why does Codex say Google Calendar is connected but calls still fail?"
- "Reconnect WorkOS/Recruitly/Gmail and verify it actually works."
- "The connector config is present but the agent keeps falling back to the browser."

### Should not trigger

- "Build a REST endpoint that has nothing to do with external tools."
- "Search the public web for competitor pricing."
- "Fix a CSS regression in the landing page."

### Conflicts

- `tool-routing-and-source-ingestion` decides which capability should be preferred.
- `mcp-integration-ops` owns making that external capability actually usable and proving it.
- `human-blocker-orchestration` owns unavoidable human auth/consent steps.
- `mcp-builder` is for authoring/improving an MCP server itself, not routine connection diagnosis.
