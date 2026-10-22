# Model and provider routing rules

Major routes by task capability, available subscription capacity and current rate-limit state — not by provider brand loyalty.

## Worker pools

- **Claude Code** — coordination, architecture, difficult diagnosis, high-risk adjudication, complex cross-cutting work, creative direction.
- **Codex** — primary implementation swarm, refactors, tests, bulk coding, independent review and parallel work.
- **Google / Antigravity** — bounded implementation, routine fixes, test/documentation work, research, browser tasks and overflow to preserve Claude/Codex headroom.
- **Cursor Agent CLI** — overflow implementation, alternate-model execution, independent review and additional parallel capacity.

These are defaults, not hard role monopolies. Route based on measured success, task fit and availability.

## State dimensions

Track independently for each worker/model:

- visible/installed;
- authenticated;
- available / rate-limited / exhausted / unknown;
- billing mode: subscription-included / credits / API-billed / unknown;
- capability/quality class;
- recent task outcomes;
- prohibited/restricted reason.

Prefer **subscription-included** capacity. Never silently switch onto credits or API billing.

## Routing policy

- Use strong reasoning for architecture, difficult root cause, consequential security and adjudication.
- Use cheaper/abundant workers for bounded execution once the contract is clear.
- Use deterministic scripts/codemods/tests instead of a model where sufficient.
- Run as many independent workers as live host capacity allows; Major derives the limit from memory headroom.
- Contract to 1–2 workers for small/local work.
- Do not duplicate identical work across providers unless independent verification or exploration has clear value.
- Preserve cross-provider review for high-consequence decisions where useful.
- After two materially unchanged failed approaches, change strategy or escalate.

## Automatic task-class defaults

Goal dispatch picks the routing class and reasoning effort from Major's own admission risk assessment (`taskRoutingRequest` in `src/supervisor/runtime.ts`). No owner input is needed.

| Task class | Signal | Class | Effort |
| --- | --- | --- | --- |
| Bounded, mechanical | short outcome, no risk keyword | sonnet | low |
| Substantive implementation | build/repair/integrate or a longer outcome | opus | medium |
| High consequence | authority, security, persistence, external effect, blast radius | fable | high |
| Unassessed, independent review | no assessment, or completion review | fable | high |

- Two consecutive failures escalate the class one step (sonnet → opus → fable).
- The class is a target, not a lock. The existing ladder, subscription-only billing and account reroute still choose the actual provider.
- Effort goes to Claude (`--effort`) and Codex (`model_reasoning_effort`). Cursor ACP and Antigravity keep their defaults.
- Owner override for one dispatch: `major run <project> --goal-id <id> --foreground --model <fable|opus|sonnet|auto>`.
- Code-changing workers receive the ponytail (full) lean-coding contract in the prompt, because workers run without user plugins and hooks. The independent review applies the ponytail-review lens as advisory evidence only.

## Cost/rate-limit objective

Optimise for **time-to-verified-outcome and subscription headroom**, not minimum token count. Track duplicate work, context size, iteration count, latency, rate limits and any real paid spend.

Paid credits/API routes require explicit authority; subscription-included use does not.
