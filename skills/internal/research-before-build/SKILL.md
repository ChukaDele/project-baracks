---
name: research-before-build
description: Find and evaluate existing solutions before implementing any non-trivial capability, integration, platform feature, workflow, component system or reusable infrastructure. Use when a task may add a dependency, service, custom framework, durable workflow, sandbox, gateway, connector or commodity feature. Do not trigger for small bug fixes, copy changes, established project-local patterns or trivial configuration.
---

# Research Before Build

## Gate

Do not write custom implementation for a non-trivial capability until this gate produces an adoption record.

Search in order:

1. current repository;
2. installed Major skills and internal templates;
3. current dependencies;
4. official framework or platform capability;
5. maintained open-source library or template;
6. commercial or free tool already available;
7. custom implementation.

Search the next layer only when the earlier layer does not fully resolve the problem.

## Evaluate candidates

For each credible option, record:

- functional coverage;
- integration and migration effort;
- release and maintenance activity;
- license and attribution duties;
- security and dependency risk;
- performance;
- lock-in and data portability;
- cost now and at plausible scale;
- reversibility;
- custom code deleted or avoided;
- evidence and remaining assumptions.

Prefer the smallest maintained solution that preserves Major policy and project constraints. Do not force an upstream abstraction across a weaker security, approval, data or lifecycle boundary.

## Adoption record

Write `.major/adoption-records/<problem-slug>.md`. Use `templates/project/ADOPTION.md` when available.

The record must state:

```text
Problem:
Existing options considered:
Chosen option:
Why:
What we reuse:
What we tailor:
What we will not build:
License/version:
Exit strategy:
Evidence:
```

Allowed decisions: keep, extend, merge, replace, wrap, trial behind a flag, reject or custom build.

Custom build is valid only when the record names the unmet requirement and why tailoring an existing option costs more or weakens a binding boundary.

## Stop rules

- Stop research when evidence clearly selects a reversible option.
- Do not add a dependency merely to satisfy this gate.
- Do not execute remote installers before inspecting their content and destinations.
- Do not create paid spend, credentials or production resources without their existing approval gate.
- Keep experiments out of client repositories and client PII.

## Acceptance

- The search order is visible in the evidence.
- License, version, maintenance and cost are explicit.
- The decision says what Major will not build.
- A custom build has a falsifiable gap statement.
- The exit strategy is credible.

Read [references/source-evaluation.md](references/source-evaluation.md) when comparing external packages or services.
