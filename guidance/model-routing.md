# Model and provider routing rules

Routing is model-level, not provider-level, and is decided by
`src/routing/router.ts` using the configurable capability registry
(`src/providers/registry.ts`, overridable at `~/.major/model-registry.json`).
Marketing model names are configuration, never code.

## Routing classes

- **Fable-class** — ambitious long-running work, autonomous orchestration, complex
  cross-cutting implementation, difficult system architecture.
- **Opus-class** — architectural analysis, difficult root-cause debugging,
  security-sensitive implementation, review adjudication, high-risk repository governance.
- **Sonnet-class** — bounded implementation, clear repairs, ordinary tests, documentation,
  routine engineering once the approach is settled.
- **Codex** — independent adversarial review, alternative implementation, test
  generation, cross-provider verification.

## Model state dimensions

Every model is tracked on orthogonal dimensions (see `agent_models` and `ModelState`):
visible; authenticated; availability (available / rate-limited / exhausted / unknown);
billing mode (subscription-included / usage-credits / API-billing / unknown); prohibited
(with reason). A model is routable only when visible, authenticated, available, and not
prohibited.

## Quality policy

- Use the strongest permitted model for architecture, difficult diagnosis, and high-risk
  work; use Sonnet-class for bounded execution once the contract is clear.
- Never spend Fable-class capacity on formatting, mechanical edits, or straightforward
  documentation.
- Escalate one class after repeated failure (every two failed repair attempts),
  contradictory review findings, or exhaustion of the repair budget.
- Preserve Codex capacity for independent review: Codex is not selected for
  non-review purposes while the reserve policy is on (default).
- Same-provider review is not independent. When no cross-provider reviewer is available,
  the run records `independence_loss` and the review is treated as advisory.

## Billing safety

- Never activate API billing automatically. Never consume usage credits automatically.
- Never continue Fable-class work onto paid usage credits without an explicit approved
  `paid_usage` DecisionRequest.
- When included allowance for the target class is unavailable, fall down the class ladder;
  when only paid options remain, checkpoint the task and pause rather than create an
  unapproved charge.
- Every run records provider, model, billing mode, routing reason, and allowance state
  (`agent_runs`), plus usage observations (`usage_observations`).
