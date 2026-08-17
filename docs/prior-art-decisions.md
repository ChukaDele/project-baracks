# Prior-art decisions

Future Major agents must consult this log before rebuilding a capability or adding substantial new infrastructure. Append a record before the build starts, including when the decision is BUILD.

Record format: Capability, Date, Candidates, Decision, Reason, Major-specific layer retained, Rejected alternatives, Evidence.

## 2026-08-17 — subscription-backed coding-agent execution driven by a coordinator

- **Capability:** subscription-backed coding-agent execution driven by a coordinator
- **Date:** 2026-08-17
- **Candidates:** Major native CLI/ACP adapters; Block goose (now hosted by the Agentic AI Foundation under the Linux Foundation, Apache-2.0, ~27k stars) which consumes ACP agents as providers and can route through Claude Code, Codex and Gemini using existing subscriptions; OpenCode (~160k stars, 75+ providers via AI SDK plus models.dev metadata); Subrouter
- **Decision:** KEEP Major's thin adapters and BORROW the ACP pattern, which Major already does
- **Reason:** goose validates the ACP-as-provider approach Major already implements via @agentclientprotocol/sdk 1.3.0 in src/execution/cursor-acp-runtime.ts, and goose is itself removing its direct claude-code/codex/gemini-cli providers in favour of ACP. OpenCode's abstraction is model/API-key routing, a different axis from subscription-backed CLI agents. Adopting goose or OpenCode wholesale would mean adopting a second agent harness and UI on top of Major's coordinator, which adds a layer rather than removing one.
- **Major-specific layer retained:** provider and capability selection, approval policy, billing evidence, durable goals
- **Rejected alternatives:** adopt goose wholesale; adopt OpenCode wholesale; build a second agent harness
- **Evidence:** the reuse matrix in docs/reuse-first-architecture-audit.md already proved Cursor native ACP against community and Harness alternatives; ACP is now broad infrastructure with JetBrains, Google and GitHub support and a public agent registry.

## 2026-08-17 — multi-account subscription quota routing

- **Capability:** multi-account subscription quota routing
- **Date:** 2026-08-17
- **Candidates:** Major native; manaflow-ai/subrouter
- **Decision:** WRAP Subrouter if and when multi-account is genuinely needed. Do not build it.
- **Reason:** Subrouter already scores each account by its most constrained usage window, protects low-headroom accounts, spends quota that resets soonest and refreshes usage on an interval. That is roughly the whole requirement. Its cost is a reverse proxy that replaces outbound credentials and stores OAuth refresh tokens outside the vendor's own store, which needs a security review before adoption.
- **Major-specific layer retained:** routing policy and billing evidence
- **Rejected alternatives:** build a Major-native multi-account router
- **Evidence:** Subrouter README documents openai_base_url and ANTHROPIC_BASE_URL interception with per-account credential substitution
- **Status:** deferred, multi-account is explicitly frozen.

## 2026-08-17 — isolated local runtime for coding agents with provider credential separation

- **Capability:** isolated local runtime for coding agents with provider credential separation
- **Date:** 2026-08-17
- **Candidates:** pinned Lima 2.2 wrapped directly (current); OpenHands Docker agent-server; Docker Sandboxes; MikD1/agent-vm; sylvinus/agent-vm
- **Decision:** KEEP the direct Lima wrap
- **Reason:** this was already audited with disposable proofs. Lima is CNCF Incubating and mature; the agent-vm projects default to host mounts and SSH-agent forwarding, which conflict with Major's no-mount, provider-separated contract; OpenHands' sandbox is a peer implementation of the same idea and switching would be a lateral move with real migration risk while the current path demonstrably works. Docker on macOS also runs inside a VM, so it is not a simpler boundary.
- **Major-specific layer retained:** workspace quarantine, validated delta copy-back, hard descendant termination by VM force-stop
- **Rejected alternatives:** switch to OpenHands Docker agent-server; Docker Sandboxes; adopt MikD1/agent-vm or sylvinus/agent-vm unchanged
- **Evidence:** docs/reuse-first-architecture-audit.md sandbox and Lima rows plus the field gates scripts/validate-cursor-acp-field.mjs and scripts/validate-cli-provider-field.mjs.

## 2026-08-17 — durable cross-project goal, learning and policy persistence

- **Capability:** durable cross-project goal, learning and policy persistence
- **Date:** 2026-08-17
- **Candidates:** Major native (SQLite plus Drizzle); OpenHands; goose; Aider
- **Decision:** BUILD, already built, and KEEP
- **Reason:** this is the exception where no mature prior art covers the requirement. OpenHands and the SWE-agent family have no persistent memory and treat each task as independent with no cross-task learning; their microagent and AGENTS.md mechanisms load static instructions instead. Aider is git-native single-session editing. Persistence is Major's differentiation, so BUILD is correct here under the 70-80 percent heuristic. Storage itself is already adopted rather than built: better-sqlite3 and Drizzle.
- **Major-specific layer retained:** durable cross-project goals, GBrain and learning, policy and autonomy
- **Rejected alternatives:** adopt OpenHands, goose or Aider persistence models
- **Evidence:** the audit of coding-agent scaffolds found no cross-task persistence in OpenHands, SWE-agent, AutoCodeRover, mini-swe-agent or DARS-Agent.

## 2026-08-17 — agent-to-tool transport

- **Capability:** agent-to-tool transport
- **Date:** 2026-08-17
- **Candidates:** provider harness MCP support; official MCP SDKs; Lima MCP Sandbox Interface
- **Decision:** DO NOT BUILD an MCP transport
- **Reason:** unchanged from the existing audit. Providers own tool transport; Major selects and authorises tools.
- **Major-specific layer retained:** tool selection and authorisation
- **Rejected alternatives:** implement a generic Major MCP transport
- **Evidence:** docs/reuse-first-architecture-audit.md MCP row.

## 2026-08-17 — targeted git-native code editing

- **Capability:** targeted git-native code editing
- **Date:** 2026-08-17
- **Candidates:** Aider; the provider CLIs Major already drives
- **Decision:** BUILD nothing; treat Aider as an optional future specialised capability, not a Major subsystem
- **Reason:** Aider remains actively maintained but stable at v0.86.2 and its architect/editor split is a narrower tool than the agent CLIs Major already routes. There is no current requirement it uniquely satisfies.
- **Major-specific layer retained:** provider and capability selection
- **Rejected alternatives:** adopt Aider as a Major subsystem
- **Evidence:** Aider release cadence and feature comparison, 2026.
