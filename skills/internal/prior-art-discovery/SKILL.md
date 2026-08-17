---
name: prior-art-discovery
description: Required gate before substantial new infrastructure: search existing implementations and record an ADOPT, WRAP, BORROW or BUILD decision.
---

# Prior-Art Discovery

This is the stronger, triggered infrastructure gate; `open-source-leverage` stays as the lighter commodity-build check.

## Trigger

Load this skill before implementing a substantial new subsystem, provider integration, agent runtime, sandbox, router, memory mechanism, auth system, scraper, workflow engine, browser system, MCP integration, installation system, deployment mechanism, or major external dependency. Do not load it for ordinary feature work inside an existing subsystem.

## Ordered process

DEFINE CAPABILITY -> CHECK EXISTING MAJOR -> CHECK GBRAIN/SKILLS -> CHECK OFFICIAL PROVIDER TOOLS -> CHECK MCP/ACP ECOSYSTEM -> CHECK MATURE OSS -> CHECK PACKAGE ECOSYSTEM -> COMPARE -> DECIDE

1. DEFINE CAPABILITY
2. CHECK EXISTING MAJOR
3. CHECK GBRAIN/SKILLS
4. CHECK OFFICIAL PROVIDER TOOLS
5. CHECK MCP/ACP ECOSYSTEM
6. CHECK MATURE OSS
7. CHECK PACKAGE ECOSYSTEM
8. COMPARE
9. DECIDE

Search by capability, never by the implementation already imagined. Bad: "find a Lima replacement". Good: "isolated local runtime for coding agents with provider credential separation".

## Decisions

Four decisions, in preference order: ADOPT, WRAP, BORROW, BUILD. BUILD is the last option, not the default.

## Evaluation criteria

capability coverage, maturity, maintenance activity, community adoption, licence, security model, provider support, API/CLI stability, extensibility, operational complexity, dependency weight, upgrade risk, integration cost, testability, rollback, platform compatibility.

## Heuristic

If a mature project already covers roughly 70-80 percent of the real requirement and the remaining part is not Major's differentiation, prefer WRAP or ADOPT over BUILD. If BUILD is chosen anyway, the decision record must say why.

## An audit is not permission to rewrite

Replace a working subsystem only for substantially higher reliability, large maintenance reduction, removal of fragile custom code, better security, better provider compatibility, or material simplification. Never for fashion, code elegance, fewer files or framework preference. Always weigh migration risk.

## Output

Append a decision record to `docs/prior-art-decisions.md` before the build starts. A decision record is required even when the decision is BUILD.

## Major's retained differentiation

External engines must sit underneath rather than replace:

- durable cross-project goals
- GBrain and learning
- skillification
- Toolsmith
- policy and autonomy
- provider and capability selection
- validation and evidence
- cross-host continuity
- project intelligence
