# Readiness and independent validation

Major must never use **built**, **validated** and **ready** as synonyms.

## Built

Implementation exists and the builder can demonstrate the intended mechanism locally.

Builder-authored tests and CI may support this claim. They do not by themselves prove readiness.

## Validated

The implementation passed relevant deterministic checks **and** an independent grader/provider attempted to falsify the important claims.

For consequential Major/harness changes:

- the grader must not be the provider that performed the last substantive build/coordinator pass;
- the grader should inspect the exact head/artefact and objective evidence;
- the grader should be read-only or isolated from the integration branch;
- a failing independent grade blocks trust promotion.

## Ready

A representative real-world outcome succeeded under the intended project trust profile.

Examples:

- Major is not ready merely because the daemon/CLI starts; it must move a real project outcome correctly.
- A UI is not ready merely because unit tests pass; the rendered path must work.
- An integration is not ready merely because a local mock passed; the real provider/state must be observed when the readiness claim depends on it.

## Promotion rule

Trust/autonomy is earned from real evidence:

`observe → assist → build → unattended`

- `observe`: context, planning, inspection; no delegated execution.
- `assist`: visible/foreground pilot, maximum 3 useful workers, no unattended background loop.
- `build`: validated autonomous build work, maximum 6 useful workers; still no unattended/login execution by default.
- `unattended`: maximum 6 useful workers, background continuation allowed only after representative real-output validation and an independent grade.

Do not increase trust merely because configuration exists or self-authored tests are green.

## Client boundary

Client/candidate/PII projects default to `client/observe` until explicitly classified otherwise. Being globally attached to Major does not grant Major or Ruflo permission to execute, read cross-project memory, or promote sensitive project information into global memory.
