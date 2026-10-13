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

Use direct fetch/search first. Use GStack/browser when rendering, interaction, JS state, authentication or structured extraction requires a real browser.

### Dynamic/authenticated web

Use GStack/browser capability when installed. GStack is a subordinate tool provider; Major policy remains authoritative. Prefer namespaced GStack commands/capabilities and keep GStack proactive routing disabled so it does not compete with Major's router.

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

## Maintained personal Knowledge Library retrieval

**Automatically consult the owner's prior knowledge when it can materially improve a substantive task.** Good triggers include research/strategy, product decisions, prior-art discovery, brand/design references, career systems, reusable agent workflows, or explicit references to saved material and earlier decisions. Decide relevance quickly. Avoid library retrieval for unrelated narrow code edits, arithmetic, trivial answers or current system-status checks.

The maintained knowledge hierarchy is:

1. **Project truth and GBrain:** Inspect relevant project files and \`LEARNINGS.md\`; use scoped GBrain decisions, patterns and outcomes when a real GBrain read capability is available. A current project decision outranks an older global note. Never import confidential data from another client.
2. **Maintained Notion synthesis:** Search the connected **Chuka Knowledge Library**, navigate the relevant Knowledge Bank and fetch 1–3 maintained Knowledge Pieces. Check the source trail, last review date, thesis, exceptions and contradictions. This synthesis outranks an unreviewed saved post.
3. **ContextBolt original saves:** When examples, source links or conflicting evidence matter, use the installed \`search_bookmarks\` connector, optionally expanding a relevant topic cluster. Do not bulk-export thousands of saves. A bookmark is a lead, not automatically a true fact.
4. **Eagle visual references:** For visual tasks, use the corresponding Design Knowledge Piece and Eagle reference set when authorized and available. Do not assume inspiration assets are licensed for reuse.
5. **Raw local corpus:** Only if maintained pieces and source connectors are insufficient, inspect bounded, relevant portions of the user-owned local archive with appropriate permissions. Never ingest the entire corpus into a prompt, check it into Git, or send unrelated project/PII information to another client or provider.

**Runtime access must be proven.** Prefer native Notion search/fetch, ContextBolt MCP bookmark search and the authorized local GBrain CLI. A ChatGPT connection does not automatically make these available in Claude, Codex or Major. Run a real read in the current host before reporting a source as accessible. If a connector is unavailable, use the remaining permitted sources, report the limitation, and do not fabricate library findings or extract credentials.

**Freshness:** Reverify time-sensitive claims (laws, tools, vendor behaviour, prices, finance, immigration, regulations) from current primary sources. Preserve disagreements with the maintained piece rather than silently overwriting it. Attribute decisions and claims to the actual source.

**Bounded receipt and privacy:** Record which relevant Knowledge Piece or GBrain note was read, which supporting bookmarks were used, and meaningful gaps. Do not put full private content in logs, public repositories or broad shared memory. Retrieval is read-only by default. Updating the maintained synthesis, bookmarks or GBrain requires a user-authorized write and review.

This is triggered source retrieval, not an always-on context dump, background sync, competing skill registry, or permission to cross project boundaries.

## Provenance

For material knowledge work, preserve:

- source URL/file/reference;
- retrieval time when freshness matters;
- ingestion method (`connector`, `yt-dlp-captions`, `macwhisper`, `gstack-browser`, etc.);
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
