# Adoption record: Major platform capability layer

## Problem

Major needs a reliable reuse gate, product-pattern research, visual-direction approval, selective component testing and browser evidence without duplicating its proven policy and execution kernel.

## Existing options considered

| Option                 | Coverage                                      | Integration    | Maintenance    | License                  | Security                                | Cost                     | Lock-in        | Code avoided                     | Evidence                                  |
| ---------------------- | --------------------------------------------- | -------------- | -------------- | ------------------------ | --------------------------------------- | ------------------------ | -------------- | -------------------------------- | ----------------------------------------- |
| Current repository     | Existing policy kernel and skills             | Low            | Project-owned  | Project                  | Preserves boundaries                    | None                     | Low            | Most runtime work                | Registry, resolver and architecture audit |
| Major skills/templates | Existing UI, research and QA skills           | Low            | Project-owned  | Project                  | Preserves boundaries                    | None                     | Low            | Skill infrastructure             | Skill inventory and overlap audit         |
| Current dependencies   | Resolver, SQLite and browser harness          | Low            | Maintained     | Current package licenses | Existing boundaries                     | None                     | Low            | New framework code               | Package and source inventory              |
| Official platform      | Vercel guidance and platform products         | Medium         | Active         | MIT or service terms     | New services require gates              | Potential usage spend    | Medium         | Mechanical UI and runtime code   | Pinned source and official docs review    |
| Maintained upstream    | Storybook, Workflow, Sandbox, Gateway and eve | Medium to high | Active or beta | MIT or Apache-2.0        | New auth, cost and authority boundaries | Free core or usage spend | Medium to high | Potential component/runtime code | Package and repository review             |
| Available tool/service | Connect and hosted platform capabilities      | Medium to high | Vendor-managed | Service terms            | Scoped credentials required             | Usage priced             | High           | OAuth and operations code        | Official capability review                |

## Chosen option

Keep the Major policy/runtime kernel. Replace five overlapping skills with five focused skills. Add one small adoption-record validator. Adapt the universal Vercel rules. Trial hosted or beta runtimes separately behind existing authority gates.

## Why

The current kernel already provides project identity, trust, approvals, durable claims, cancellation, isolation, learning and independent grades. The main defect is capability selection and verification, not missing orchestration infrastructure.

## What we reuse

The existing resolver, registries, global/project guidance, provider/Lima runtime, browser preflight, resource leases, durable SQLite state and independent grading. We also adapt the reviewed MIT-licensed Vercel mechanical interface rules.

## What we tailor

Major-specific search order, adoption evidence, Workshop/Product boundaries, three-direction owner approval, remote-first browser evidence and precise resolver triggers.

## What we will not build

A second workflow engine, hosted sandbox abstraction, API-model gateway, credential platform, visual-inspection runtime or generic agent framework in this slice. We also will not add Storybook to Major because Major has no React component surface.

## License and version

Vercel Web Interface Guidelines commit `4e799d45c17aec1498c269287a83b9dba22b966b`, MIT. Storybook addon 10.5.7, MIT, evaluated but not installed. Workflow 4.8.2, Sandbox 3.0.0, AI SDK 7.0.64, Gateway 4.0.51 and eve 0.34.0 were evaluated but not installed.

## Exit strategy

Revert the focused branch. No database migration, provider credential, M1 flag, installed runtime or production service changes. Git retains the retired skill versions.

## Evidence

`docs/platform-capability-integration-audit.md`, five resolver eval fixtures, a 20-scenario routing matrix, adoption-record unit tests, Major validation gates and an independent exact-head grade before merge.
