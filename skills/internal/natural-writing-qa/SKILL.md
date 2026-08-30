---
name: natural-writing-qa
description: Provenance-aware post-draft critic that detects and explains recurring model-like prose patterns, preserves claims and voice, and requests only targeted revisions before a second audit.
---

# Natural Writing QA

This is one post-draft critic, not a primary writer or detector-evasion tool. Its rule behavior is informed by the MIT-licensed `conorbronsdon/avoid-ai-writing`, `blader/humanizer`, and `brandonwise/humanizer`; see `docs/prior-art-decisions.md`.

1. Preserve code, quotations, facts, citations, qualifications, legal effect, and technical instructions.
2. Detect first. Report concrete spans and context-sensitive reasons: canned transitions, fake significance/profundity/candor, vague attribution, unsupported objection handling, forced punchlines, repeated openings, excessive headings/lists, uniform rhythm, repeated trigrams, and suspicious vocabulary density.
3. Treat short-text statistics as low confidence. Never label authorship or pursue a detector score.
4. Revise only real defects. Paragraphs may be split, merged, reordered, or rebuilt while every claim survives. Never invent personal detail or strengthen a claim.
5. Run a second audit and stop when remaining flags are legitimate, quoted, technical, voice-authentic, or mere preference.
