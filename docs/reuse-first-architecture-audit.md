# Major reuse-first architecture audit

Status: integrated, pre-activation validation complete
Frozen code baseline: `32ddfe59d3b2149fa86c564a5e36b567065dd06a`
Audit date: 2026-08-12

This audit freezes additional custom provider-runtime implementation until a
maintained upstream option has been checked and, for material replacements,
proved in a disposable environment.

## Frozen change inventory

The release candidate adds the proposed Lima backend, tests, templates and
bootstrap assets. `src/execution/lima-backend.ts` currently owns process
spawning, stream parsing, locking, VM lifecycle, workspace transfer, run
manifests, stale cleanup and patch application. This is generic infrastructure
and is the main replacement target.

Nothing from the accepted Lima proof has been discarded. M1 remains disabled.

## Reuse matrix

| Subsystem | Current implementation | Strongest existing solution | Decision | Evidence and boundary |
| --- | --- | --- | --- | --- |
| Task understanding, risk and decomposition | Major domain services and policy | No generic runtime has Major's project and blast-radius policy | KEEP | This is differentiated Major logic. |
| Model and provider routing | Major router, billing evidence and model registry | AI SDK model/provider registry | KEEP | Major routes subscription-backed coding agents and enforces independent review and billing evidence. AI SDK's model abstraction solves direct model calls, not this policy problem. Capability discovery should replace hard-coded model lists. |
| Claude agent runtime | Custom CLI argv and NDJSON parsing | AI SDK `HarnessAgent` plus `@ai-sdk/harness-claude-code`; official Claude CLI | KEEP THIN CLI ADAPTER | Harness subscription, typed output/usage, mutation, stop/resume and approval proofs passed. Production adoption was rejected for v0.5.1 because abort plus destroy left the Claude process re-parented to guest PID 1. Adding a new sandbox-provider implementation while retaining mandatory VM force-stop would increase release complexity without removing the hard lifecycle boundary. Keep the official CLI and revisit after upstream orphan cleanup is fixed. |
| Codex agent runtime | Custom CLI argv and NDJSON parsing | AI SDK `HarnessAgent` plus `@ai-sdk/harness-codex`; official Codex CLI | KEEP THIN CLI ADAPTER | Harness subscription, output, stop/resume and cancellation proofs passed. Adoption was nevertheless rejected: the adapter explicitly rejects built-in approval mode and its bridge configures Codex with an unrestricted inner sandbox. Major keeps the official CLI read-only because the batch protocol cannot expose each tool decision to Major. Reuse the CLI and its JSON protocol; do not force HarnessAgent across this weaker security seam. |
| Cursor agent runtime | Custom CLI argv and stream parsing | Cursor's first-party ACP server plus `@agentclientprotocol/sdk` | REPLACE | The pinned Linux binary exposes `cursor-agent acp`. Disposable proofs initialized ACP v1, streamed typed thought/message/tool events, cancelled a live turn with `stopReason: cancelled`, exited cleanly, listed and loaded a persisted session, exposed the provider model catalogue, and wrote exact guest-owned files using the existing subscription login. |
| Community Cursor ACP adapter | Not yet used | `cursor-agent-acp@0.1.1` | DELETE / DO NOT ADOPT | Source returns `end_turn` before the provider completes, marks cancellation without stopping the child, invents session IDs, and does not implement several advertised features. Native Cursor ACP is stronger. |
| Antigravity agent runtime | Custom CLI argv, settings rewrite and stream parsing | Official Google Antigravity SDK | KEEP THIN CLI ADAPTER | The official `0.1.10` Linux arm64 wheel installed successfully. A live guest proof with the existing subscription and all API-key/ADC variables absent failed before session creation with the SDK's explicit `GEMINI_API_KEY` requirement. The SDK cannot replace the subscription-backed CLI today. Keep no more than a thin official CLI adapter and re-evaluate when Google adds consumer-subscription auth. |
| Generic session state | Provider-specific session refs and custom outcome fields | Official CLI session references; ACP for Cursor | WRAP | Harness lifecycle was rejected for this release. Major persists only routing, policy, evidence and opaque upstream resume coordinates. Cursor create/load is native ACP. Claude, Codex and Antigravity retain their official CLI resume coordinates. |
| Generic streaming protocol | Line-by-line JSON parsing in Major | Official provider JSON output; ACP session updates for Cursor | WRAP | Cursor's duplicate CLI flags and stdout protocol were removed. The three selected CLI integrations keep thin parsing because their stronger SDK/Harness alternatives failed subscription, approval or lifecycle gates. |
| Tool loop and tool results | Provider-native CLI behavior plus planned custom parsing | HarnessAgent, ACP and Antigravity SDK | REPLACE | Upstreams already transport tool calls/results. Major keeps tool policy and evidence only. |
| Human approval mechanism | Major decision records plus provider CLI modes | Harness tool approvals, ACP permission requests and Antigravity policy hooks | WRAP | Keep Major's approval policy and durable decision evidence. Replace provider-specific approval transport. |
| MCP transport | No active generic implementation in Major | Provider harness MCP support; official MCP SDKs; Lima MCP Sandbox Interface | DELETE / DO NOT BUILD | Major should select and authorize MCP tools, not implement MCP. Lima's MCP command is experimental and is not required for provider execution. |
| Sandbox contract | New custom `ExecutionBackend` | AI SDK `HarnessV1SandboxProvider`; Lima 2.2 | KEEP THIN PORT, WRAP LIMA | The upstream Harness contract covered most generic calls, but adopting it would add a second lifecycle layer without removing the VM force-stop boundary. No maintained Lima provider met Major's isolation contract. `ExecutionBackend` remains the narrow Major policy boundary and directly wraps pinned Lima commands. |
| Lima VM creation and registry | Hand-managed template plus new controller | Lima 2.2; `MikD1/agent-vm`; `sylvinus/agent-vm` | WRAP LIMA DIRECTLY | Lima is mature and accepted. `agent-vm` projects are small and default to host mounts, SSH-agent forwarding and project-wide guest access, which conflict with Major's no-mount, no-forwarding, provider-separated proof. Their registry/reconciliation patterns are useful, but neither is safe as an unchanged dependency. |
| Lima command/file execution | Custom spawn, copy and lifecycle code | Lima `shell`, `copy`, `watch`, `snapshot`, `--sync` | WRAP | Prefer maintained Lima commands. Do not use `shell --sync` for automatic release mutation: non-TTY mode rsyncs changes and deletions directly to the host without Major's quarantine, concurrent-change check or evidence gate. |
| Workspace quarantine and delta validation | `workspace-transfer.ts` plus custom copy-back and Git patch | No upstream candidate meets the full host-mutation boundary | KEEP, SIMPLIFY | Major-specific requirements include excluded private trees, returned-tree validation, concurrent host-change refusal, quarantine and evidence before applying a delta. Use Lima copy primitives underneath but retain this boundary. |
| VM/process termination | Custom host process group plus VM stop | Harness lifecycle plus Lima stop/force-stop | WRAP | A live Claude abort proved that Harness destroy can leave its provider process re-parented to guest PID 1. A VM force-stop terminated it and produced a verified `Stopped` state. Major must use force-stop as the hard descendant boundary on cancel, timeout, controller loss or cleanup uncertainty, then verify `Stopped` before releasing the lease. Normal upstream stop/destroy remains the graceful path. |
| Authentication | Proposed credential-aware provider homes | Provider-owned subscription authentication | KEEP OUT OF MAJOR | Major records only available, unavailable or human action required. It must not become a generic credential manager. Existing opaque guest credentials remain provider-owned and project data must not be copied into them. |
| Run evidence and release gates | Major DB, manifests and supervisor | No upstream replacement | KEEP | Provenance, leases, exact-head release evidence, graders and project isolation are differentiated Major responsibilities. |
| Learning and GBrain | Major learning pipeline | No generic agent runtime replacement | KEEP | Project/global isolation, sanitation, review and promotion are Major-specific. |

## Dependency health

| Candidate | Current evidence | Licence | Stability | Decision risk |
| --- | --- | --- | --- | --- |
| AI SDK 7 / HarnessAgent | `ai@7.0.62`, `@ai-sdk/harness@1.0.68`; active patch cadence in `vercel/ai` | Apache-2.0 | Harness packages are labelled experimental despite stable `1.0.x` versions | Pin exact versions behind one Major runtime port and contract tests. Subscription auth and Lima bridge are unresolved. |
| Claude/Codex harness adapters | `1.0.70`; maintained in `vercel/ai` | Apache-2.0 | Experimental; active fixes to bridge startup, streaming and MCP | Do not expose adapter types outside the runtime integration. |
| ACP TypeScript SDK | `@agentclientprotocol/sdk@1.3.0`; active official repository | Apache-2.0 | ACP v1 stable; v2 explicitly draft | Pin v1. Do not import the experimental v2 entry point. |
| Cursor native ACP | Pinned guest binary `2026.08.11-e8db854`; native `acp` command proved | Proprietary provider binary; ACP SDK Apache-2.0 | First-party implementation, version-bound | Attest the binary and run ACP contract tests on upgrades. |
| Google Antigravity SDK | Source version `0.1.10`; official Linux arm64 wheel installed and imported | Apache-2.0 | Alpha; compiled platform wheel; API/Vertex auth only | Rejected for the current provider path because it does not consume the authenticated Antigravity subscription. |
| Lima | Pinned `2.2.0`; CNCF Incubating project | Apache-2.0 | Mature core; MCP, tunnel, snapshot and some plugins remain experimental | Keep to stable `create/start/list/shell/copy/stop/protect` contracts. |
| `MikD1/agent-vm` | `v0.2`, 5 stars, active July 2026 | MIT | Early project | Do not take as a runtime dependency. Re-evaluate if its isolation model matures. |
| `sylvinus/agent-vm` | 93 stars, small shell implementation | MIT | Community utility | Does not cover Major's lifecycle, provider or evidence contract. |

## Implemented target dependency map

```text
Major policy, routing, approvals, evidence, learning and release gates
                              |
                    ExecutionBackend port
                              |
                    direct pinned Lima 2.2
                              |
                    isolated major-worker VM
                              |
      +----------------+------+----------------+
      |                |                       |
official Claude   official Codex        official Antigravity
  CLI + JSON        CLI + JSON              CLI + JSON
      |                |                       |
      +----------------+-----------+-----------+
                                   |
                     Cursor native ACP v1 server
                                   |
                @agentclientprotocol/sdk 1.3.0

Major keeps a separate workspace quarantine and validated-delta boundary
between guest output and a live host worktree.
```

The provider choices are resolved: thin official CLI adapters for Claude,
Codex and Antigravity, plus native ACP v1 for Cursor. HarnessAgent remains a
tracked future replacement, not a v0.5.1 dependency. Major does not own an MCP
transport. Providers own tool transport; Major owns policy and durable approval
evidence. Major will not introduce paid API credentials to make an upstream
abstraction fit.

## Required disposable proofs before migration

1. Claude HarnessAgent: subscription auth, typed output, write task,
   built-in-tool approval pause and stop/resume passed. Cancellation returned
   but left a PID-1 provider child. Production adoption is rejected for this
   release; keep the thin official CLI plus mandatory VM force-stop.
2. Codex HarnessAgent: subscription auth, typed output, write task,
   stop/resume and cancellation passed. Production adoption was rejected
   because built-in approval is unsupported and the bridge selects an
   unrestricted inner sandbox. Keep the official CLI in read-only mode until a
   per-tool approval protocol is available.
3. Cursor native ACP: execution, explicit cancellation, typed completion,
   forced transport cleanup, session load and exact output passed.
4. Antigravity SDK: Linux arm64 wheel passed; consumer subscription auth failed
   by explicit SDK validation. The thin official CLI adapter is the selected
   fallback.
5. Thin Lima sandbox proof: the Harness sandbox contract, a dedicated SSH
   loopback forward and provider-specific guest identity passed for Claude and
   Codex without public ports or host mounts. Production lifecycle and policy
   tests remain.
6. Production integration must demonstrate that the AI SDK sandbox contract can be
   implemented without weakening plain mode, host isolation or guest-provider
   separation. Reject it if the bridge requires public or broadly forwarded
   ports.

The disposable proofs resolved every provider-protocol row. Production changed
only the proved Cursor path; rejected candidates left no runtime dependency.

## Integrated Cursor field evidence

The checked-in opt-in gate `scripts/validate-cursor-acp-field.mjs` executes the
production `LimaBackend`; it cannot pass by using a fake provider or by writing
its own marker. On 2026-08-12 it passed with the authenticated subscription and
the pinned `major-worker` instance:

- create run `125d0019-2314-47bd-93b4-5d4ad2e98a8a` produced the exact nonce file,
  one provider result and typed ACP updates;
- resume run `afcbef6a-f362-43d9-84bb-7e675909aa4c` preserved session
  `6fd6d9da-541b-4908-ae18-1393d7415737` and produced only the second exact file;
- cancel run `c845526b-ee09-4414-8880-ed5daba32cc6` started from a real ACP update,
  returned `cancelled` with complete cleanup and copied no forbidden file;
- the Lima instance was verified `Stopped` after each phase.

This is a pre-activation runtime gate. It does not bypass or open M1. The exact
activation commit must repeat provider and product fields through the public
Major path.

The companion `scripts/validate-cli-provider-field.mjs` passed the declared
provider capability and complete cleanup for Claude, Codex and Antigravity.
Claude is limited to read/edit/search tools. Codex and Antigravity are
read-only because their batch protocols do not expose per-tool approval. The
gate initially falsified
Antigravity success: without `--new-project`, the CLI wrote into its private
scratch directory while claiming it had modified the assigned workspace. The
official project flag fixed the workspace binding and the repeated exact-file
gate passed.

## Project-local provider state

Guest metadata inspection found project conversations and workspace-derived
paths in every long-lived provider home. Provider Unix users prevent one
provider from reading another provider's home, but all projects routed to a
given provider share that provider's history, cache and session databases. This
would violate the required project-local isolation boundary if used directly.

The runtime therefore uses a disposable per-project/per-provider run home
seeded only from one exact opaque provider-owned authentication file. Project
state is stored under a root-owned full project hash. The owner authorised the
opaque in-VM migration of each exact credential file. No macOS credential was
copied or inspected. Deterministic tests prove cross-project isolation,
authentication persistence, reset behavior, and fail-closed handling of unsafe
filesystem entries.

## Code deletion and complexity estimate

Cursor's obsolete prompt, model, resume, trust, sandbox and stream CLI flags
were deleted from the execution contract. Cursor now has one protocol owner:
the provider's native ACP server. The rejected HarnessAgent and Antigravity SDK
spikes added no production dependencies or code.

The release candidate still adds about 2,100 lines across the Lima boundary,
bootstrap, field gate and focused tests. The core custom runtime is the 855-line
`LimaBackend`, plus 114 lines of workspace quarantine and 195 lines of
configuration, provider profiles, manifests and invariant checks. This is a net
complexity increase, not a claimed reduction. It remains because no maintained
candidate met the no-host-mount, provider separation, validated copy-back and
hard descendant termination contract. The one new protocol dependency is
`@agentclientprotocol/sdk@1.3.0`; the production tree contains no AI SDK Harness
dependency.

## v0.5.1 P1 runtime and installation remediation

- Execution evidence now crosses both backend boundaries. Claude and Codex
  event extractors reach Lima, and the supervisor preserves session, usage,
  cleanup and runtime model metadata when present. Missing metrics stay absent.
- Cursor uses ACP `session/set_config_option` when the session advertises a
  model selector. It confirms the returned current value before prompting. A
  missing selector or requested value fails explicitly. Outcomes preserve the
  capability and confirmed actual model.
- The shared `major-worker` runtime is serialized at one concurrent worker in
  project policy and the global resource queue. Browser and build limits remain
  independent.
- Clean installation provisions and health-checks `major-worker` before user
  state activation. Provisioning is idempotent. A failure deletes only a worker
  created by that installation and never deletes a pre-existing worker.

## 2026-08-17 consolidation refresh

The original 2026-08-12 matrix is unchanged. This refresh records layers that
audit did not cover, plus a re-check of the conclusions that still hold.

Newly covered: goose, OpenHands, OpenCode, Aider, Subrouter, the ACP
ecosystem's maturation, goal and session persistence, workflow orchestration,
install/update/rollback, diagnostics and support bundle, memory, skills and
Toolsmith.

Per-capability decisions now live in `docs/prior-art-decisions.md`. The
provider-runtime and sandbox conclusions were re-checked and still hold.

Current dependency surface, as evidence of a reuse-first posture: 5 runtime
dependencies (`@agentclientprotocol/sdk`, `better-sqlite3`, `commander`,
`drizzle-orm`, `zod`) across about 21,000 lines of TypeScript.

## 2026-08-20 DeepSeek Harness live runtime

AI SDK `HarnessAgent` remains rejected for production. DeepSeek Harness is a
different upstream: MIT, plugin-composed, and wrapped as a Major distribution
without a live `package.json` dependency until the pin is integrity-attested.
See `docs/prior-art-decisions.md` (2026-08-20) and
`docs/migrations/deepseek-harness-strangler.md`. Native DSH execution with a
local trusted workspace is the default. Lima remains an optional isolation
provider and rollback path.
