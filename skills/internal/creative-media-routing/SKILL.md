---
name: creative-media-routing
description: Use for image, video, audio, vector, 3D, creative asset generation/editing/upscaling, stock/open media discovery, reusable character/product/style references, or creative workflows. Prefer the owner's authorized Magnific MCP while its subscription/credits/auth are available; fall back to Openverse only for open-licensed image/audio discovery when Magnific is unavailable, and route unsupported modalities to another already-authorized capability or a precise checkpoint.
---

# Creative Media Routing

Use one creative-media decision layer instead of making each model choose providers ad hoc.

## Provider priority

1. Reuse a suitable existing asset/creation when that satisfies the brief.
2. While the owner's Magnific entitlement, OAuth session and credits are available, use the Magnific MCP as the primary creative provider.
3. If Magnific is unavailable because the plan/credits/auth no longer permit the requested operation, use Openverse for **open-licensed image or audio discovery** when discovery/reuse can satisfy the task.
4. If the task still requires generation, transformation, video, vector generation, 3D, or another operation Openverse does not provide, route to another already-authorized Major capability/provider if one exists.
5. If no validated provider can perform the operation, checkpoint with the exact missing capability. Do not pretend Openverse is a generative replacement.

The owner has authorized use of the existing Magnific subscription/credit balance for requested creative work. This does **not** authorize purchasing extra credits, upgrading a plan, or creating unrelated paid spend.

## Magnific MCP

Canonical endpoint: `https://mcp.magnific.com`.

Treat the live MCP `tools/list` response as the source of truth because Magnific can add capabilities without a Major release. Do not hard-code a reduced allowlist when the client can expose the full server safely.

Use the available Magnific operations as the job requires, including:

- account balance / project usage;
- browsing, showing, uploading and organizing prior creations;
- image generation, SVG/vector generation/conversion, upscaling, cropping, resizing and background removal;
- image/video model discovery and explicit model selection when deterministic model choice matters;
- video generation;
- text-to-speech / voice selection and any additional audio tools present in the live server;
- 3D generation;
- reusable custom references for consistent characters/products/styles;
- folders and Spaces/workflows;
- newly exposed Magnific tools discovered at runtime.

### Cost and reuse

Before a costly or batch creative operation when cost could materially matter:

1. search existing creations for a reusable result;
2. check `account_balance` when balance uncertainty matters;
3. use the minimum sufficient generation/transformation;
4. prefer one validated high-quality result over blind variant spam;
5. reuse references/workflows for consistency instead of regenerating from scratch.

Reading account balance or browsing existing creations should be preferred before unnecessary generation when practical.

### Model choice

Default to provider auto-routing when the brief does not require a specific model. Use the model catalog/list/show tools and choose explicitly when the task has a capability, quality, consistency, resolution, speed or format requirement that makes model choice material.

Do not assume the model catalog is static.

## Openverse fallback

Canonical API: `https://api.openverse.org`.

Current first-class fallback media are:

- images: `/v1/images/`
- audio: `/v1/audio/`

Openverse is a discovery/reuse source, not a generation/editing engine.

When selecting an Openverse asset, preserve at minimum:

- title;
- creator;
- creator URL when present;
- source/provider;
- direct/landing URL;
- license + version;
- license URL;
- attribution text when returned.

Openverse license metadata is not a legal guarantee. Verify the work's license against the upstream/landing source before publication or commercial use, especially for client work.

Prefer results whose license is compatible with the intended use. Do not silently choose a restrictive license merely because the asset is visually better.

## Expiry / failure detection

Do not guess that the Magnific subscription has expired from a calendar date. Detect actual availability through provider state and representative calls.

Examples that justify fallback/escalation:

- OAuth/session no longer authorizes the account and re-auth does not resolve it;
- account/plan does not permit MCP use;
- credit balance cannot support the requested generation and the owner has not authorized buying more;
- provider returns a durable entitlement/payment exhaustion signal;
- Magnific is unavailable after the normal integration-repair/fallback path.

Transient provider errors are not subscription expiry. Use `mcp-integration-ops` for connection/auth/tool-exposure failures before changing provider.

## Cross-model behavior

This routing policy is model-independent. Claude, Codex, Cursor, Gemini and Antigravity should receive the same creative-media intent and use the native Magnific MCP exposed by their host when available. The creative provider is a capability; the reasoning model is not the provider.

Do not route creative tasks differently merely because a different reasoning model is coordinating the work.

## Full-capability principle

Use the full provider capability only when it helps the requested outcome. "Full capabilities" does not mean call every tool. It means do not artificially restrict a valid creative workflow to image generation when video/audio/vector/3D/editing/references/Spaces or creation reuse is the better route.

## Verification

Before claiming Magnific is installed or usable in a host, distinguish:

`configured -> exposed -> authenticated -> permissioned -> representative operation succeeded -> integrated into the actual workflow`

A config file alone is not operational evidence. Follow `mcp-integration-ops` for setup/repair and `human-blocker-orchestration` for unavoidable OAuth approval.

## Skill interactions

- `mcp-integration-ops`: install/expose/authenticate/prove Magnific in each host.
- `human-blocker-orchestration`: OAuth or account/payment decisions requiring the owner.
- `cost-control`: expensive/batch creative decisions.
- `source-ingestion`: user-supplied images/video/audio and named source material.
- `design-direction-and-taste`: decides visual direction; this skill chooses/acquires the media capability.
- `tools-as-code`: repeated Openverse/API retrieval, filtering and attribution normalization.
