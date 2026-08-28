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

## Lightweight SDLC profile

Use `decideSdlc` from `src/domain/sdlc.ts` as the deterministic policy primitive.
A low-risk change touching at most two files with one acceptance path needs only a
clear intent, spec and focused proof. Substantive or risk-bearing work keeps compact
intent, spec, plan and evidence state in `GOAL_STATE.md`.

Review follows consequence: no mandatory independent review for a small low-risk
change, focused review for substantive ordinary work, and independent review for
authority, security, irreversible or broad-blast-radius changes. Existing project
policy continues to govern external effects and owner-only gates.

Use `planProgressiveValidation` for the default evidence plan: focused tests, the cheapest
relevant compile/type/build check, and critical-path behavior. Add task-specific risk checks when
the task has a material risk. Broaden validation only for an explicit blast-radius,
shared-dependency, insufficient-evidence, historical-regression, or promotion-policy trigger.

Review findings use `BLOCKER`, `IMPORTANT`, or `NIT`. Nits and explicitly labelled
speculation are non-blocking; speculation becomes a finding only when evidence establishes
an actionable defect. BLOCKER findings block promotion. IMPORTANT findings must be triaged
and recorded but do not automatically block a usable and safe MVP. See `REVIEW.md` for the
concise promotion policy.

Use `assessPromotion` after pre-promotion evidence and the selected review. A candidate with that
evidence, a passed required review, and no BLOCKER findings is `PROMOTABLE`, which permits normal
merge/install. Installation is not a prerequisite for PROMOTABLE; it remains separate proof after
promotion, preventing a circular install gate.

Record installation proof separately as `not_required`, `unproven`, or `proven`.
Record representative behaviour as `unproven` or `proven`. Installation alone never
makes work READY; READY requires the applicable validation/review, any required
installation proof, and a representative behaviour outcome under the intended trust
profile. For low-risk work whose review level is `none`, deterministic checks can
support VALIDATED without inventing an independent-review requirement.

Use `assessTaskDeliveryEvidence` to record evidence for the states relevant to the task:
`IMPLEMENTED`, `TESTED`, `STAGED`, `RESOLVED`, `LOADED`, `FOLLOWED`, `INSTALLED`, and
`BEHAVIOURALLY_PROVEN`. An applicable state is proven only by a non-empty evidence record.
States outside the task's delivery path are `not_required`; never demand or claim them merely
because the vocabulary exists. This matrix supplements rather than replaces the canonical
BUILT/VALIDATED/READY assessment and its independent-review and representative-outcome gates.

For a failure, keep its reproduction and executable regression verification in the
project. Submit only a separate sanitized, generalisable principle to the existing
GBrain learning lifecycle. A regression artifact is not itself global learning.

## Client boundary

Client/candidate/PII projects default to `client/observe` until explicitly classified otherwise. Being globally attached to Major does not grant Major or Ruflo permission to execute, read cross-project memory, or promote sensitive project information into global memory.
