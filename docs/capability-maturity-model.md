# Capability maturity: reference → skill → adapter → native

Major uses the lowest maturity stage that proves the outcome. Stages are evidence claims, not a delivery checklist.

| Stage | What exists | Required evidence | What it does not mean |
| --- | --- | --- | --- |
| Reference | Authoritative upstream source and provenance are recorded. | Exact repository, license, maintenance/dependency notes, and a reuse decision. | Installed, executable, safe, or product-compatible. |
| Skill | Major can route a representative task to bounded operating guidance. | Canonical skill, registry entry, positive/negative resolver fixtures, reachability tests. | The upstream tool is configured or operational. |
| Adapter | A replaceable Major boundary exchanges the minimum data or operation. | Contract tests with representative data, offline/failure behavior, privacy and license review; no duplicate system of record. | The upstream application is installed, authenticated, or proven end to end. |
| Native | The capability is an intentionally supported Major runtime path. | Representative field outcome, lifecycle/rollback/observability, independent validation, accepted dependency and license obligations. | Permanent preference; evidence can demote it. |

Promotion requires evidence for every preceding stage. Demotion is valid when maintenance, privacy, performance, license, or field evidence changes. A reference can skip directly to a small adapter only when no upstream code is copied and the boundary is independently implemented.

## Current decisions

- **Taleshape Shaper:** `adapter`. Major exports bounded aggregate run telemetry as JSON/CSV through `major telemetry shaper`; Shaper remains optional and outside the runtime dependency graph. A real Shaper import/render is deferred until an operator chooses and authorises a deployment.
- **GraphDeco Gaussian Splatting:** `skill`. The reference and constraints are documented and routed, but native/runtime adoption is deferred because the official implementation is non-commercial research/evaluation software and requires a supported CUDA environment plus consented spatial capture data.
