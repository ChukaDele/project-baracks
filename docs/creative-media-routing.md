# Creative media routing

Major uses one model-independent creative-media policy.

## Primary provider: Magnific MCP

Endpoint: `https://mcp.magnific.com`

Magnific is the owner's primary creative provider while the existing subscription, OAuth session and credit balance permit the requested operation. The owner has authorized requested creative work to consume the existing Magnific balance. Major must not buy extra credits or upgrade the plan without separate authority.

Magnific is configured user-globally for supported Major hosts with:

```sh
pnpm configure:creative-media
```

The setup preserves unrelated MCP servers and configures:

- Claude Code: user-scoped streamable HTTP MCP through the native `claude mcp` CLI;
- Codex: streamable HTTP MCP through the native `codex mcp` CLI when available;
- Cursor: `~/.cursor/mcp.json`;
- Gemini CLI: `~/.gemini/settings.json` using `httpUrl`;
- Antigravity 2.0: `~/.gemini/config/mcp_config.json` using `serverUrl`.

OAuth is intentionally not stored in Major. Magnific uses OAuth and each host completes its own sign-in the first time it connects/uses the server.

Do not claim the integration is operational from config alone. Verify configured -> exposed -> authenticated -> permissioned -> representative operation -> integrated workflow under `mcp-integration-ops`.

Magnific's live MCP `tools/list` is the capability source of truth. Do not maintain a static allowlist that prevents new provider tools from becoming usable.

## Fallback: Openverse

Openverse is the no-subscription fallback for **open-licensed image and audio discovery**:

- `https://api.openverse.org/v1/images/`
- `https://api.openverse.org/v1/audio/`

It is not a replacement for Magnific generation/editing/upscaling/video/vector/3D capabilities.

If Magnific becomes unavailable:

1. if an existing/open asset can satisfy the brief, search Openverse for images/audio;
2. preserve creator/source/license/attribution provenance;
3. verify the license at the upstream landing source before publication/commercial use;
4. if generation/transformation/video/3D is still required, route to another already-authorized validated Major capability;
5. checkpoint only if no available capability can perform the exact operation.

Do not infer subscription expiry from a date. Prefer actual Magnific entitlement/auth/credit/provider evidence.

## Cost behavior

Before expensive or batch work, reuse existing creations where suitable and check the Magnific account balance when uncertainty is material. Browsing prior creations and checking balance should not be replaced by unnecessary regeneration.

## Why this is a skill, not kernel code

Magnific and Openverse are providers. The durable behavior is the routing procedure: choose the media path that satisfies the brief, preserve provenance, control spend, recover when a provider becomes unavailable, and keep the reasoning model independent from the creative provider.
