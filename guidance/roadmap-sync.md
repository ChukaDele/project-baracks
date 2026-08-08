# Project state and roadmap synchronisation

A project may use GitHub Issues/Projects, Linear, Notion, a document, a database table, another system or no external roadmap at all. Major must not assume one provider or workflow.

## Canonical project state

- Each project declares its source(s) of truth and ownership rules in project configuration.
- Use stable IDs/keys, not row positions, display order or fragile text matching.
- Keep goal, P0/P1/P2 priority, current bottleneck, next action, status and evidence durable enough that a fresh worker can resume safely.
- Do not duplicate canonical state across multiple tools unless a clear synchronization contract exists.

## External writes

When Major writes to an external project system:

- use the provider's smallest reliable adapter/API;
- make repeatable writes idempotent where duplicate execution could cause harm;
- preserve existing human edits unless the active task explicitly replaces them;
- confirm the external system reached the intended state rather than trusting only local response text;
- attach or reference objective evidence when marking an outcome complete;
- surface provider failures as a bottleneck and continue independent work when possible.

## Authority

Major may automatically update routine project/task state when the project grants that authority and objective evidence supports the change.

Human approval is required only when the underlying action itself is a human-only gate under `human-approval.md` or project configuration. A generic roadmap status change is not automatically a human gate.

## Provider neutrality

Provider-specific details belong behind adapters or project configuration. Do not put Google Sheets, Linear, Notion, GitHub or any client-specific assumption into Major's global workflow rules.

## No-roadmap projects

Do not force a roadmap integration on a small or exploratory project. A concise project goal, priority backlog and durable status file/database are sufficient when they are the simplest useful source of truth.