# Tool routing and source ingestion

Major should solve the user's actual task with the best available tool. Do not default to an LLM when a deterministic connector, API, CLI, parser or browser is better.

## Core rule

**Intent → classify source/task → choose the best native/deterministic tool → follow the relevant fallback chain → use model reasoning after reliable evidence is available.**

A failed first tool is not a failed task.

## Tool preference

Prefer, in order when applicable:

1. the source's native connector/API;
2. a maintained deterministic CLI/parser;
3. direct HTTP/search for public static content;
4. an authenticated/interactive browser for dynamic or protected content;
5. local multimodal/transcription tools for audio/video/images;
6. model inference only for interpretation, synthesis, judgment or gaps that genuinely require reasoning.

Do not use browser automation when a native connector/API is simpler and more reliable. Do not use an LLM to reproduce work a deterministic tool can do exactly.

## Primary-source integrity

When the user asks to summarize, analyze or extract from a specific source, obtain that source or its faithful transcript/content before answering.

Do **not** silently replace a requested primary source with:

- search-result snippets;
- articles discussing the source;
- social posts quoting it;
- model memory;
- a reconstructed summary from secondary sources.

If the primary source cannot be obtained after the relevant fallback chain, say that clearly. Secondary-source reconstruction is allowed only when the user explicitly accepts that substitution.

## Fallback discipline

Before reporting that a source/tool is unavailable:

1. identify the source type;
2. try the best direct method;
3. try the next materially different method;
4. use authentication/browser/local extraction when relevant and authorised;
5. record what failed;
6. declare a blocker only when the remaining alternatives are unavailable, disproportionate, unsafe or require owner action.

Do not repeat the same failing method with superficial parameter changes. After two materially unchanged failures, change strategy.

## Source routes

### GitHub

Use GitHub API/connector for repositories, files, commits, PRs, issues and Actions. Do not scrape GitHub pages unless the API/connector genuinely cannot provide the required content.

### Google Drive / Docs / Sheets

Use the native Google connector/API. Do not browser-scrape a connected document merely because a page URL exists.

### Gmail / Calendar / Contacts

Use their native connectors.

### Figma

Use Figma tooling/connector for file/node/design operations. Browser use is a fallback for human-visible inspection, not the main data path.

### Public static web page

Use direct fetch/search first. Use browser automation when rendering, interaction, JS state, authentication or structured extraction requires a real browser.

### Dynamic/authenticated web

Use the host's browser automation (built-in browser, Playwright or Chrome DevTools). Browser tools are subordinate tool providers; Major policy remains authoritative.

### Repeated web extraction

Prototype with browser/scrape. Once the procedure is stable, codify it into a deterministic reusable extractor/skill with fixtures/tests rather than paying model/browser cost on every repetition.

### YouTube

Default chain:

1. `yt-dlp` direct metadata/captions;
2. human subtitles when available;
3. auto-generated subtitles when available;
4. if captions are unavailable or unusable, download audio with `yt-dlp`;
5. transcribe locally with MacWhisper CLI `mw`;
6. if YouTube requires login/consent and direct retrieval fails, use authorised browser cookies/session through `yt-dlp` or a browser route;
7. only then declare source access blocked.

Do not search for articles about the video and present that as analysis of the video.

### Local audio/video

Use MacWhisper CLI for speech transcription when text is needed. Prefer local models for privacy and subscription preservation. Use `mw transcribe <file>`; structured JSON may be used when the installed MacWhisper licence supports it.

### PDF / document / spreadsheet

Use the appropriate native parser/skill before OCR or screenshots. Use rendered inspection when layout/visuals matter.

### Image

Use native vision for understanding. Use image-generation/editing tools for actual image transformation rather than describing edits that were not performed.

## Curated Knowledge Library retrieval — Notion is the cross-topic authority

**The maintained Notion Knowledge Library is the authoritative source for distilled cross-topic knowledge.** For substantive research, strategy, product decisions, writing, career systems, design references, prior-art discovery or reusable agent workflows, assess whether a Knowledge Piece could materially improve the task. If yes, search the relevant Knowledge Bank and fetch the best 1–3 maintained Notion Knowledge Pieces before relying on prior lessons. Inspect review date, thesis, supporting primary evidence, caveats and contradictions. Skip retrieval for unrelated narrow code edits, arithmetic and trivial lookups.

**Source precedence**

1. For the *current project's operational state*, use authorized project files. Use GBrain on demand only: when the owner explicitly asks, or when a named hand-written GBrain entity page is relevant. Never retrieve from GBrain on every task or treat it as primary memory. A current project decision outranks an older global Notion note. Do not mix data from unrelated clients or projects.
2. For *maintained conceptual knowledge*, use the Notion Knowledge Bank → comprehensive Knowledge Piece. GBrain notes or saved social posts are not substitutes for a maintained Notion synthesis.
3. For facts that decay (regulations, finance, vendor behavior, prices, external tools), verify against the latest primary/official evidence. If Notion and current evidence disagree, keep the distinction visible.
4. For design tasks, inspect the appropriate maintained Notion Design Knowledge Piece and optionally Eagle for visual references when authorized. Do not assume inspiration media or assets are licensed for copying.

**ContextBolt is excluded from automatic retrieval.** Its saved bookmarks, social posts and raw X/Instagram corpus are not completely reviewed, distilled or triaged. Do not call ContextBolt, inject its unreviewed content, or use it as a fallback if a Notion query returns no result. It is an **explicit ingestion and triage tool only**: use it when the owner directly requests review, mining, source-level comparison or backfill; label its contents unverified and reconcile them into a maintained Notion Knowledge Piece before treating them as operational knowledge. Do not bulk export, paste raw corpora into prompts, send unrelated client/PII material to another project or provider, or bypass client-data boundaries.

**Runtime access check:** Prefer the native connected Notion search-and-fetch API. Installed or ChatGPT-connected does not mean Claude, Codex or Major is authenticated; verify an actual Knowledge Piece fetch in the current host before reporting it as operational. When Notion is unavailable or no piece covers the question, say so and proceed with current project state and verified primary research, never silent ContextBolt substitution. Do not fabricate a Knowledge Piece, claim a page was read when access failed, or attempt to extract private connector credentials.

Record which Notion piece was consulted, its date and material gaps. Retrieve in proportion to the task, preserve disagreements and attribute critical factual claims to the primary evidence or relevant Notion piece. Do not put full private library content into logs, public repositories, broad shared memory or unrelated project contexts. Retrieval is read-only by default; updating Notion, GBrain or any maintained knowledge record requires explicit owner authorization. This is not an always-on context dump or a separate skill router.

## Provenance

For material knowledge work, preserve:

- source URL/file/reference;
- retrieval time when freshness matters;
- ingestion method (`connector`, `yt-dlp-captions`, `macwhisper`, `browser`, etc.);
- whether content is primary or secondary;
- known extraction gaps;
- citations/anchors sufficient to trace load-bearing claims.

## Cost/capacity routing

Use deterministic/local tools before consuming scarce model capacity when they can perform the same operation. Use Google/other abundant model capacity for bounded low-stakes research or extraction when appropriate; reserve stronger/scarcer coding/reasoning capacity for work where it improves the outcome.

## Completion

Source ingestion is complete when Major has either:

1. faithful source content/transcript with provenance; or
2. a clear, truthful blocker after the relevant fallback chain has been exhausted.

A plausible answer generated without the requested source is not source-ingestion success.
