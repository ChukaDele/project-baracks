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
- `assist`: visible/foreground pilot, maximum 1 worker, no unattended background loop.
- `build`: validated autonomous build work, maximum 1 worker; still no unattended/login execution by default.
- `unattended`: maximum 1 worker, background continuation allowed only after representative real-output validation and an independent grade.

`SUPERVISED_WORKSHOP` readiness and final release readiness are distinct. Workshop readiness requires real foreground provider work through the Lima/project boundary. `FINAL_RELEASE_ATTESTATION` starts only after a candidate is frozen and uses one exact-SHA Secure Enclave signature. A defect that changes code aborts that attestation rather than starting a repeated sign-fix loop.

Do not increase trust merely because configuration exists or self-authored tests are green.

## Client boundary

Client/candidate/PII projects default to `client/observe` until explicitly classified otherwise. Being globally attached to Major does not grant Major or Ruflo permission to execute, read cross-project memory, or promote sensitive project information into global memory.
