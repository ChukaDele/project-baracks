---
name: engineering-design-doctrine
description: Use when evaluating a material design, module seam, abstraction, domain boundary, or multi-worker design conflict. Provide reference principles only; do not start a refactor or widen scope.
---

# engineering-design-doctrine

## Reference role

Supply a compact decision lens. Reduce cognitive load with deep modules, information hiding and small high-leverage interfaces. Preserve orthogonality, knowledge-level DRY, tracer bullets, reversible decisions, contracts and feedback. Preserve conceptual integrity through explicit constraints, seams, interfaces and invariants. Use ubiquitous language and bounded contexts only where ambiguity or a hard-to-reverse decision exists. Reject abstraction unless it hides demonstrated complexity, simplifies an interface and reduces blast radius.

## Boundary

Do not plan or execute broad refactors. A driver owns execution and QA. Return the principle, alternatives, recommended constraint and what remains deliberately simple.
