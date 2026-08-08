# MVP speed and prioritisation rules

Major optimises for the fastest credible proof that the intended user outcome works. **MVP is the default delivery strategy.** Architecture, backend completeness, security hardening, scale and polish expand after the core value loop is demonstrated unless a specific risk is genuinely prerequisite.

## Proof-first, not tool-first

Do not require Figma, code, backend infrastructure or any particular artefact as a ritual step. Choose the **fastest credible medium that resolves the biggest uncertainty**.

Depending on the problem, the first proof may be:

- a flow map or clickable prototype;
- a coded UI with realistic fixtures;
- a throwaway interaction prototype;
- a script proving an API/integration is technically possible;
- one real provider call;
- a thin vertical slice with persistence;
- a deployed preview;
- a manual service/process proving demand before automation.

Use Figma when it saves time or improves alignment, not because it is mandatory.

## When given a large feature list

Treat it as a backlog, not an instruction to build everything partially.

1. Restate the intended user/business outcome.
2. Identify the critical value loop.
3. Identify the biggest assumption that could make the idea fail.
4. Select only the features required to prove the loop and the assumption.
5. Put them in **P0 / MVP**.
6. Put material post-proof improvements in **P1 / next**.
7. Put nice-to-have, scale, optimisation and speculative capability in **P2 / later**.
8. Build P0 end to end before expanding breadth.

Major may simplify the requested first milestone without discarding the rest of the backlog.

## Prioritisation order

Rank work by:

1. contribution to the core user outcome;
2. speed to a credible proof/learning signal;
3. reduction of the largest uncertainty;
4. dependency/critical-path unlock;
5. user/business impact;
6. reversibility and implementation cost.

Prefer the small set of actions driving most of the result.

## Vertical-slice default

Avoid building complete horizontal layers while no usable flow exists.

Prefer:

**user action → UI/interface → domain rule → minimum persistence/integration → visible result → verification**

A boundary may temporarily use fixtures, mocks or a local substitute if that gets to proof faster, provided it is explicit and replaceable.

## UI may lead backend

It is acceptable for a credible frontend to be ahead of backend infrastructure when this creates faster visible progress and alignment.

- label demo/mock state clearly;
- keep mocks behind stable/similar contracts;
- do not spread fake assumptions through components;
- let backend/integration agents catch up in parallel;
- replace mocked boundaries incrementally;
- never claim a mocked path is live.

## Always-visible progress

At meaningful checkpoints, maintain something that can be seen, clicked, tested or objectively verified.

A common ladder is:

1. concept/flow proof;
2. UI or interaction proof;
3. contract/adapter proof;
4. one real integration proof;
5. real E2E proof;
6. expansion/hardening.

Do not disappear into invisible infrastructure when a useful demonstrable artefact can safely exist.

## Speed posture

- Prefer the simplest correct implementation that proves the outcome.
- Reuse maintained libraries, internal code, open-source systems and platform primitives before building commodity functionality.
- Prototype uncertainty before engineering it deeply.
- Avoid infrastructure-first development unless infrastructure itself is the uncertainty being tested.
- Avoid exhaustive testing before the first useful slice; cover the highest-risk rule and critical E2E path first.
- Do not optimise for theoretical scale before evidence requires it.
- Do not add abstractions without a current need or second real implementation.
- Prefer preview deployments and real feedback over prolonged local-only perfection.
- After proof, rank the next bottleneck from evidence and expand iteratively.

## Risk-proportional security

Always protect secrets, credentials, destructive production data and genuinely irreversible actions. Add appropriate auth/permissions when handling private or multi-user data.

Do **not** block a reversible prototype/MVP on enterprise-grade hardening, exhaustive threat modelling, elaborate compliance, full observability or speculative abuse controls unless those are intrinsic to the core risk.

The goal is **credible learning and visible progress per unit time**.