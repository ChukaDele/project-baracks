---
name: lean-graph-engineering
description: Design lean task graphs for complex autonomous builds using explicit dependencies, parallel branches, verifiers, repair loops, human gates and stop rules.
---

# Lean Graph Engineering

Use a graph only when linear work is insufficient.

1. State final outcome.
2. Draw minimum nodes.
3. Mark deterministic vs agent nodes.
4. Add only real dependencies.
5. Parallelise independent branches.
6. Separate consequential implementation and verification.
7. Bound repair loops.
8. Add human gates only for irreversible, costly, production or policy decisions.
9. Keep durable shared state simple.
10. Avoid one giant orchestrator prompt, every-step-as-agent, infinite retries and unclear shared ownership.