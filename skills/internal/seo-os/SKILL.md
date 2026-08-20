---
name: seo-os
description: Use for substantive SEO, search growth, technical SEO, keyword/content opportunity research, site architecture, authority/link work, local SEO, AI-search visibility/GEO/AEO, SEO measurement, or autonomous SEO improvement. Orchestrates evidence, prioritisation, safe execution, verification and learning while reusing OpenSEO and other mature providers instead of rebuilding commodity tooling.
---

# SEO OS

Use this skill for substantive SEO work. It is Major's canonical SEO strategy/orchestration layer. It does **not** replace specialist tools, crawlers, Search Console, analytics, OpenSEO, browser QA or code execution; it coordinates them.

The detailed standing architecture and OpenSEO synthesis is recorded in `docs/seo-os-open-seo.md`. This skill is the compact executable guidance Major should load for SEO tasks.

## Core operating model

Major owns:

- strategy and search-growth reasoning;
- evidence selection;
- prioritisation and expected-value ranking;
- orchestration across tools/providers;
- safe autonomous implementation;
- verification and regression checks;
- measurement and learning.

OpenSEO should be treated as a preferred SEO data/tool substrate and workflow reference where it is available and useful, not as Major's ceiling or a second control plane.

Reuse order:

`existing Major capability → mature upstream/open solution → thin adapter/composition → minimal bespoke code`

Do not rebuild keyword APIs, crawlers, rank tracking, SERP retrieval, backlink indexes or other commodity capabilities when a maintained provider already solves the requirement well.

## SEO context first

For each domain/project, build or retrieve durable context before making recommendations:

- business model and commercial goal;
- ICP/audiences;
- positioning and differentiators;
- products/services;
- conversion goals and money pages;
- markets/geographies;
- commercial competitors;
- actual SERP competitors;
- content/page inventory;
- keyword/topic universe;
- backlink/authority state;
- rankings and Search Console performance;
- AI-search visibility where measurable;
- prior SEO changes, experiments and outcomes;
- brand/editorial constraints.

Do not repeatedly rediscover stable context. Update it when evidence changes.

## Evidence and freshness discipline

Before paying for or re-fetching SEO data:

1. inspect existing project research/history;
2. determine whether the required evidence already exists;
3. judge freshness needed for the current decision;
4. reuse sufficiently fresh evidence;
5. refresh only stale or missing slices.

Prefer primary/live evidence when feasible: Search Console, analytics, live SERPs, live pages, crawler output, source code, rendered browser output, provider APIs.

## Opportunity discovery order

For established sites, start with demonstrated demand and near-wins before generic discovery:

1. Search Console queries/pages already receiving impressions;
2. queries around positions roughly 5–20 where realistic improvement can produce near-term value;
3. high-value pages with declining or underperforming visibility;
4. competitor/SERP gaps;
5. broader keyword/topic expansion.

Do not prioritize by search volume alone.

Default opportunity model:

`commercial relevance × conversion value × probability of material visibility gain × traffic/discovery upside × strategic importance ÷ total effort/cost/risk`

Use modifiers where relevant:

- current rank/impressions;
- domain/page authority;
- topical authority;
- SERP weakness;
- page/intent fit;
- content gap;
- link requirement;
- technical dependency;
- freshness/trend;
- time to impact;
- competitive moat/replicability;
- probability traffic converts;
- AI-search visibility value;
- opportunity cost versus alternative actions.

Use the model comparatively; do not pretend uncertain inputs are precise.

## Competitor model

Always distinguish:

- **commercial competitors** — compete for the same customer;
- **SERP competitors** — capture the searches that matter.

SERP competitors may be publishers, directories, marketplaces, communities, forums, job boards, aggregators, UGC platforms or other non-obvious entities. Strategy should respond to who actually owns the result set, not only the sales competitor list.

## Technical SEO verification loop

Crawler/scanner output is a possible finding, not a final diagnosis.

For consequential technical issues:

`detect → independently verify on live/current implementation → diagnose root cause → estimate impact → fix → re-crawl/re-test → regression check`

Avoid noisy audit dumps. Verify before changing production behavior when verification is feasible.

For JavaScript-heavy sites, render and inspect the real page. OpenSEO or any non-rendering crawler is not sufficient evidence by itself when JS rendering materially affects indexing or content discovery.

## Site architecture and internal links

Treat architecture as a search system, not just navigation polish. Evaluate:

- page roles and search intent;
- topic/entity coverage;
- cluster relationships;
- cannibalisation;
- orphan pages;
- click/crawl depth;
- internal anchor relevance;
- links from authoritative/high-traffic pages;
- discovery paths for money pages;
- duplicated/thin indexable surfaces.

Prefer systematic internal-link improvements tied to page roles and opportunity value over arbitrary link counts.

## Content

Content work must match search intent **and** create business value. Assess:

- intent satisfaction;
- factual/evidence quality;
- entity/topic completeness;
- differentiation from the current SERP;
- first-hand or proprietary evidence where available;
- trust/credibility signals;
- readability and information architecture;
- internal links;
- conversion alignment;
- freshness and update needs.

Do not create generic SEO filler. Existing pages should be improved before creating near-duplicates when consolidation has better expected value.

## Authority and link acquisition

Backlink prospecting starts with a reason to link.

Sequence:

1. identify/create a genuinely link-worthy asset or proposition;
2. identify relevant prospect classes;
3. qualify topical/business relevance and likelihood to link;
4. define the specific outreach angle;
5. rank by expected authority/relevance/business value;
6. integrate with Major's prospecting capabilities where useful.

Do not confuse generic sales prospecting with SEO link acquisition.

## Local SEO

When local search matters, include:

- Google Business Profile state;
- NAP/citation consistency where useful;
- review quality/velocity and response practices;
- local landing pages;
- local-pack visibility;
- geo-grid evidence when available;
- location-specific intent and SERP composition.

## AI visibility / GEO / AEO

Treat AI-answer visibility as first-class search discovery, not an optional appendix.

Where measurable, track:

- prompt/question universe;
- brand/entity mentions;
- cited sources;
- share of voice;
- competitor visibility;
- source pages influencing answers;
- entity/content gaps;
- changes over time.

Do not assume classic blue-link rankings fully describe discovery.

## Measurement and learning

SEO output is incomplete until outcomes can be observed.

Track the smallest useful set of:

- Search Console impressions/clicks/CTR/average position;
- rankings where decision-relevant;
- organic sessions/engagement;
- leads, revenue or other conversion outcomes;
- indexed/crawled state for technical changes;
- AI-search mentions/citations where available;
- change dates and affected pages;
- confidence/uncertainty around attribution.

Avoid false causal claims from simple before/after movement. Record competing explanations when material.

## Autopilot behavior

For safe, sufficiently verified work Major should:

> Find everything. Rank everything. Fix what is safe. Surface only the highest-value decisions that genuinely require the owner.

Autonomous loop:

1. retrieve context and current evidence;
2. identify opportunities/problems;
3. rank by expected business value;
4. select the highest-value feasible action;
5. implement within trust/project policy;
6. verify with live/browser/crawler/source evidence;
7. measure or establish the measurement baseline;
8. update persistent SEO context;
9. continue to the next highest-value action while marginal value remains attractive.

`seo-autopilot` is an orchestration mode, not a separate duplicate implementation.

## Composition with Major skills

Common pairings:

- `source-ingestion` — named SEO sources, files, URLs and primary evidence;
- `knowledge-work` — deep SEO/market synthesis and research;
- `open-source-leverage` / `prior-art-discovery` — evaluate OpenSEO and other mature providers before building;
- `mcp-integration-ops` — connect/repair OpenSEO MCP or other SEO integrations;
- `website-design-qa` — customer-facing production/browser/launch QA;
- `root-cause-qa` — reproduce and diagnose technical regressions;
- `data-learning-loop` — outcome-driven learning without false causality;
- `source-adapter-engineering` — thin provider adapters when APIs/feeds are needed;
- `cost-control` — paid SEO API usage and caching discipline.

`website-design-qa` owns the broad website quality pass; `seo-os` owns search-growth reasoning, SEO prioritisation and the cross-domain SEO program.

## Where Major must exceed OpenSEO

Do not let OpenSEO become the ceiling. Compose stronger tools/skills where needed for:

- JavaScript-rendered auditing;
- advanced crawling/crawl-space control;
- log-file analysis;
- technical SEO engineering/code fixes;
- structured data implementation/validation;
- internal-link architecture;
- international/hreflang SEO;
- site migrations;
- programmatic SEO;
- content production/refresh systems;
- CRO and revenue attribution;
- browser/runtime QA and regression testing;
- autonomous code/deployment changes under Major policy.

## Stop / escalate conditions

Stop autonomous modification and surface the decision when:

- the change is irreversible or materially risky;
- production credentials/consent are required;
- two high-value strategies depend on unresolved business positioning;
- evidence conflicts materially and additional data has high value of information;
- a migration/domain/indexation change could create broad downside;
- the next action requires substantial paid spend not already authorized.

Otherwise continue with the highest-value safe action rather than turning the audit into a to-do dump.

## Resolver examples

### Should trigger

- "Do a complete technical and on-page SEO audit, fix what is safe and prioritise the rest."
- "Find our highest-value organic growth opportunities using GSC, SERPs and competitors."
- "Improve internal linking and site architecture so our money pages rank better."
- "Build an SEO content plan based on what we already rank for and what competitors own."
- "Check our visibility in AI answers and improve GEO/AEO as part of SEO."
- "Use OpenSEO with our existing Major skills rather than rebuilding SEO tooling."

### Should not trigger

- "Fix the spacing on this dashboard card."
- "Why is this SQL query slow?"
- "Draft a cold email to this prospect."
- "Make this animation smoother."

### Conflicts

- `website-design-qa` owns broad visual/responsive/launch quality; compose it when SEO work touches production-site QA.
- `knowledge-work` provides general research rigor; `seo-os` owns the SEO-specific decision model.
- `open-source-leverage` and `prior-art-discovery` own the general reuse gate; `seo-os` applies it specifically to SEO providers such as OpenSEO.
