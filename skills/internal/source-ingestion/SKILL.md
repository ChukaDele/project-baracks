---
name: source-ingestion
description: Use whenever the user asks to summarize, analyze, extract, compare or learn from a specific URL, video, file, repository, document, audio source or other named primary source. Route to the best native/deterministic tool, follow source-specific fallbacks, preserve provenance, and never substitute secondary-source reconstruction without saying so.
---

# Source Ingestion

1. Identify the requested source and what the user needs from it.
2. Classify the source: GitHub, Google file, public web, dynamic/authenticated web, YouTube, local audio/video, PDF/document, spreadsheet, image or other.
3. Use the source's native connector/API or deterministic parser/CLI before general browser/LLM work.
4. Follow the source-specific fallback chain in `guidance/tool-routing-and-source-ingestion.md`.
5. For YouTube: captions → auto-captions → `yt-dlp` audio → MacWhisper `mw` → authenticated browser/cookies when authorised.
6. Preserve source URL/reference, retrieval method and meaningful gaps.
7. Do not answer as if the requested primary source was read when only secondary material was available.
8. If direct ingestion fails, change method rather than repeating the same failed approach.
9. Once faithful content exists, hand it to the appropriate research/analysis workflow.
10. A plausible reconstructed answer is not a successful ingestion.
