---
name: simple-modular-code
description: Produce the simplest correct, reusable and replaceable implementation for architecture and coding tasks.
---

# Simple Modular Code

A major element should be replaceable like an Excel formula: keep the contract, swap the implementation, leave unrelated areas untouched.

- one clear responsibility;
- explicit typed inputs/outputs;
- business rules independent of UI/database/provider SDKs;
- isolate side effects at boundaries;
- pure functions where practical;
- provider-specific code behind adapters;
- explicit dependencies, minimal hidden state;
- no abstraction without a current need or second implementation;
- contract tests for genuinely swappable boundaries;
- prefer boring, widely understood patterns;
- delete obsolete competing paths.

## Merged aliases

Also answers to the retired `software-engineering` skill id (merged 2026-10-23). When a single specialist procedure is already known, route directly to that specialist.
