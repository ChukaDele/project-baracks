---
name: knowledge-work
description: Use for substantial research, strategy, synthesis, comparisons, decision memos, market/product analysis or other knowledge work where source quality and reasoning matter. Define the decision, ingest primary sources with the right tools, scale research depth to stakes, use independent skeptic review when useful, and stop once there is enough evidence to make the next good decision.
---

# Knowledge Work

## Goal

Produce a decision-useful answer, not the largest possible research dump.

## Default loop

1. State the decision/question and what would count as a useful answer.
2. Identify the biggest uncertainty and the minimum credible evidence needed.
3. Ingest named primary sources with `source-ingestion` before interpreting them.
4. Choose research depth based on stakes and uncertainty.
5. Run independent research branches only where they cover materially different angles.
6. Use a skeptic/reviewer that did not author the main conclusion when consequence or uncertainty justifies it.
7. Synthesize surviving evidence into BLUF, reasoning, assumptions, risks and next action.
8. Preserve citations/provenance for load-bearing claims.
9. Distil reusable methods/learnings without promoting private/project-specific facts globally.
10. Stop when additional research is unlikely to change the decision.

## Research depth

### Light

Use for low-stakes, reversible questions with clear sources.

- one researcher / direct source pass;
- targeted verification;
- concise synthesis.

### Standard

Use for consequential but reversible decisions.

- planner;
- 2–4 independent research angles;
- skeptic/reviewer;
- synthesizer.

### High-stakes / high-uncertainty

Use when errors are expensive, difficult to reverse or likely to propagate.

- explicit reference class / alternatives;
- independent source collection;
- competing hypotheses;
- skeptic/adversarial review;
- source-quality and contradiction check;
- assumptions and what evidence would change the conclusion;
- human decision gate when required.

## Tool routing

Do not assign an LLM to retrieve content that a native connector, deterministic CLI, parser or browser can obtain more reliably. Use model capacity for interpretation, judgment and synthesis.

Use abundant/lower-cost model capacity for bounded source collection where quality is adequate. Reserve stronger reasoning capacity for synthesis, ambiguity, contradiction and difficult decisions.

## Anti-slop rules

- Do not cite a secondary source as proof of what a named primary source said when the primary source was not obtained.
- Do not let the authoring agent be the only grader of its own conclusion for consequential work.
- Do not expand research because more sources are available; expand only if they reduce a real uncertainty.
- Separate evidence from inference.
- State material source gaps.
- Prefer a clear recommendation with conditions over an unranked list of possibilities.

## MVP equivalent for knowledge work

The knowledge-work version of MVP is **minimum credible evidence for the next good decision**.

Do not spend eight agents proving a reversible low-value choice. Do not make a high-consequence decision from one convenient source.
