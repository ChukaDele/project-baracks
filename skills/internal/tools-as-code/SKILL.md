---
name: tools-as-code
description: Use when a task needs repeated retrieval, filtering, fan-out, dedupe, ranking, transformation, or multi-step deterministic tool calls that would otherwise consume many model turns. Compose approved tools/CLIs/connectors with a short temporary program, then reason over the result.
---

# Tools as Code

Use model reasoning for judgment. Use short code for repeatable mechanics.

## Trigger

Prefer Tools-as-Code when the task contains a repeated deterministic pattern such as:

- retrieve many sources, then filter/dedupe/rank;
- query the same provider/entity set repeatedly;
- transform/normalize many records;
- join outputs from multiple deterministic tools;
- compare many files/repos/items using the same rule;
- batch media/source ingestion;
- run the same validation across many targets.

Do not create a script when one direct tool call is simpler.

## Procedure

1. State the information/result needed.
2. Select the approved native tools/connectors/CLIs that already expose the needed primitive.
3. Write the smallest temporary Python/TypeScript/shell program that composes those primitives.
4. Keep secrets out of source and output; use existing authenticated tools rather than copying credentials.
5. Execute the program in the project/workshop trust boundary.
6. Return a compact structured result to the reasoning model.
7. Preserve provenance for source-derived claims.
8. Delete/discard one-off code after use unless it has durable product value.
9. If the primitive is likely to recur, invoke `skillify` and promote only after tests/evals.

## Example shape

Instead of:

`model → search → model → search → model → filter → model → search`

prefer:

`model → generate small retrieval program → retrieve/fan-out/dedupe/filter/rank → model synthesis`

## Guardrails

- Do not bypass Major project trust or owner gates.
- Do not use generated code to smuggle unapproved network/filesystem access around tool restrictions.
- For client/PII projects, do not export records to global memory or unrelated services.
- Prefer deterministic transforms for exact arithmetic, parsing, dedupe, sorting and validation.
- If generated code becomes elaborate orchestration infrastructure, stop and simplify; the agent/skill layer should own judgment.
