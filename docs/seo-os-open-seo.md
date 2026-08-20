# SEO OS — OpenSEO integration memory

Status: **standing reusable architecture decision; not yet a validated/published skill pack**

Date: 2026-08-20

## Decision

Treat OpenSEO as a high-value **SEO capability/data substrate and skill reference library**, not as a wholesale replacement for Major's SEO intelligence.

Major should reuse OpenSEO's mature/open components wherever they solve the problem well, then keep Major's differentiation in orchestration, reasoning, autonomous execution, verification, prioritisation, learning, and cross-tool composition.

Preferred architecture:

```text
Major SEO OS
  strategy / reasoning / prioritisation / learning
        ↓
OpenSEO MCP + GSC + browser/crawler + analytics + codebase + other SEO providers
        ↓
Evidence
        ↓
Action
        ↓
Verification / re-crawl / regression check
        ↓
Outcome measurement
        ↓
Persistent SEO context + improved future decisions
```

Do **not** fork or rewrite OpenSEO by default. First inspect upstream, import only net-new or superior capabilities, normalize them into the existing Skills Library, merge overlaps, and preserve one canonical Major path.

## Standing integration sequence

When implementing this capability:

1. Audit the current Major SEO skills/capabilities before changing anything.
2. Inspect current OpenSEO upstream and pin the exact source/version used.
3. Build a capability overlap matrix: existing Major vs OpenSEO vs genuinely missing.
4. Import/adapt only net-new or clearly superior components.
5. Merge duplicate concepts rather than creating parallel skills/registries/memory systems.
6. Connect OpenSEO MCP as a data/tool provider where it improves evidence quality or avoids rebuilding data access.
7. Add Major-specific missing capabilities.
8. Add resolver triggers/negative triggers, deterministic validation where applicable, and representative SEO evals.
9. Run end-to-end website SEO proof, independent review, and outcome checks.
10. Only then promote/sync validated SEO skills into the active Major skill bundle.

Reuse hierarchy remains:

`existing Major → mature upstream/open solution → thin adapter/composition → minimal bespoke code`

## OpenSEO concepts to preserve

### 1. Persistent per-domain SEO context

Maintain durable SEO state for each domain/project rather than restarting research every task. At minimum:

- business and business model;
- ICP / audiences;
- positioning and differentiators;
- products/services;
- conversion goals;
- markets / geographies;
- commercial competitors;
- actual SERP competitors;
- money pages;
- content inventory;
- keyword/topic universe;
- authority/backlink state;
- rankings / GSC performance;
- AI-search visibility;
- experiments and changes;
- historical results;
- writing/brand constraints where relevant.

This should evolve toward an SEO knowledge graph rather than a flat prompt context blob.

### 2. Cache/freshness/reuse before paying for data again

Before calling paid SEO data sources:

1. inspect existing research/history;
2. determine whether the required evidence is already present;
3. assess freshness requirements for the decision;
4. reuse sufficiently fresh results;
5. refresh only stale or missing slices.

This rule applies beyond SEO where equivalent paid/repeated data retrieval exists.

### 3. Exploit near-wins before generic discovery

For established sites, inspect Google Search Console first. Queries/pages already ranking approximately positions 5–20 often have substantially higher near-term expected value than unrelated high-volume keywords.

Then enrich with:

- intent;
- volume;
- difficulty/competition;
- commercial relevance;
- SERP composition/weakness;
- ranking page fit;
- conversion potential;
- authority/link requirements;
- freshness/trend.

Do not reduce SEO strategy to keyword volume.

### 4. Separate business competitors from SERP competitors

SEO competitors are the sites/entities currently capturing the searches that matter, including publishers, directories, marketplaces, communities, forums, job boards, aggregators and UGC platforms.

Always identify both:

- **commercial competitors** — compete for the customer;
- **SERP competitors** — compete for search attention.

The strategy may differ materially between the two.

### 5. Detection is not verification

Scanner/crawler output is evidence of a possible issue, not proof of the final diagnosis.

Required loop for consequential technical findings:

`detect → independently verify on live/current implementation → diagnose root cause → estimate impact → fix → re-crawl/re-test → regression check`

Do not report or automatically fix noisy audit findings without verification when verification is feasible.

### 6. Link prospecting starts with a reason to link

Do not optimize for large lists of generic backlink prospects.

Start from:

- the linkable asset/value proposition;
- prospect class and topical fit;
- evidence that the prospect can plausibly link;
- the specific outreach angle;
- expected authority/relevance/business value.

Then integrate with Major's prospecting/customer-acquisition capabilities where useful without conflating SEO link acquisition with general sales prospecting.

### 7. AI visibility / GEO / AEO is first-class

Treat visibility in AI answers and generative search surfaces as part of the SEO OS rather than an optional afterthought.

Track where feasible:

- prompt/question universe;
- brand/entity mentions;
- citations/sources;
- share of voice;
- competitor visibility;
- source pages influencing answers;
- content/entity gaps;
- changes over time.

Do not assume classic blue-link ranking alone captures search discovery.

### 8. SEO UX principle

Major should:

> Find everything. Rank everything. Autonomously fix what is safe and sufficiently verified. Surface only the highest-value decisions that genuinely require the owner.

Avoid dumping unprioritized audit lists.

## Canonical SEO OS capability map

Use these as conceptual modules. Before creating any new skill, run overlap/reachability checks against the live Skills Library and update existing skills when appropriate.

### `seo-context`

Persistent business/domain/SEO state, goals, ICP, positioning, competitors, key pages, history and constraints.

### `seo-opportunity-research`

GSC analysis, keyword/topic research, SERP research, competitor discovery, demand analysis, opportunity scoring and prioritisation.

### `seo-technical`

Crawling/indexation, robots/sitemaps, canonicals, redirects/status codes, rendering, structured data, performance/Core Web Vitals, JavaScript SEO, duplicate/crawl-space issues and technical search QA.

### `seo-site-architecture`

Information architecture, topic clusters, page roles, cannibalisation, internal linking, orphan pages, navigation and crawl/discovery paths.

### `seo-content`

Search intent, briefs, evidence/entity coverage, content creation/refresh, editorial quality, trust signals, usefulness, differentiation and conversion alignment.

### `seo-authority`

Backlink gaps, linkable assets, digital PR, partnerships, directories/citations where relevant, prospect qualification and outreach opportunities.

### `seo-local`

Google Business Profile/local search, local pages, citations, reviews, local-pack/geo-grid visibility and location-specific consistency.

### `seo-ai-visibility`

GEO/AEO/LLM-answer visibility, prompt sets, citations, entity/source influence, share of voice and competitor analysis.

### `seo-measurement`

GSC, analytics, rankings, conversions/leads/revenue, experiments, before/after comparisons and uncertainty-aware attribution.

### `seo-autopilot`

Select the highest-expected-value next action, execute within project/trust policy, verify, measure outcome, update SEO context, and choose the next action.

`seo-autopilot` is an orchestrator, not a second SEO implementation.

## Opportunity scoring

Do not hard-code one universal formula without calibration, but use this structure as the default decision model:

```text
SEO opportunity value ≈
commercial relevance
× conversion value
× probability of material ranking/visibility gain
× traffic/discovery upside
× strategic importance
÷ total effort / cost / risk
```

Relevant modifiers can include:

- current rank / existing impressions;
- current authority;
- topical authority;
- SERP weakness;
- content/page fit gap;
- link requirement;
- technical dependency;
- freshness/trend;
- competitive moat / replicability;
- time to impact;
- probability that traffic converts;
- AI-search visibility value;
- opportunity cost versus other SEO actions.

Prioritisation must optimize business outcomes, not vanity SEO metrics.

## Where Major must go beyond OpenSEO

OpenSEO should not become the ceiling. Maintain/add stronger capabilities where needed for:

- JavaScript-rendered auditing;
- advanced crawling and crawl-space control;
- log-file analysis;
- technical SEO engineering and code fixes;
- structured-data implementation/validation;
- internal-link architecture;
- international/hreflang SEO;
- site migrations;
- programmatic SEO;
- content production and systematic refresh;
- conversion optimisation;
- analytics/revenue attribution;
- robust browser/runtime QA and regression testing;
- autonomous code/deployment changes under Major trust policy.

Where another mature tool solves one of these better than OpenSEO, prefer composing it rather than recreating it.

## OpenSEO role

Default role:

- SEO data provider through MCP where useful;
- source of reusable agent-native workflow patterns;
- reference implementation for keyword research, clustering, competitive analysis, auditing, link prospecting, local SEO, rank tracking and AI visibility;
- optional UI/inspection surface, not Major's required control plane.

Do not make Major dependent on OpenSEO's UI or assume all OpenSEO features are exposed through MCP. Verify live upstream capabilities at integration time.

## Validation/promotion rule

This document is durable memory/architecture guidance, **not proof that an SEO skill is operational**.

Before any imported/adapted SEO capability is called active/validated:

- confirm current upstream behavior/version;
- prove tool/MCP connectivity where required;
- prove resolver reachability;
- run representative positive and negative cases;
- run a real website audit/research/action example;
- independently review consequential findings/actions;
- verify post-change runtime/search evidence where feasible;
- ensure no duplicate parallel skill or memory system was introduced.

After validation, package stable procedures through Major's existing `skillify` lifecycle and activate via the canonical skill bundle (`major skill sync` + strict audit) rather than copying ad-hoc skill files into runtime state.

## Retrieval instruction for future Major agents

When a task involves SEO, technical SEO, keyword research, content SEO, site architecture, backlink/link prospecting, local SEO, rank tracking, GSC opportunity analysis, GEO/AEO/AI-search visibility, or autonomous website search improvement:

1. retrieve this decision/context;
2. inspect the current Skills Library and project SEO context;
3. reuse available OpenSEO/upstream capabilities where they remain suitable;
4. use current evidence rather than assuming this 2026-08-20 capability snapshot is still accurate;
5. preserve the architecture and reuse rules above unless later evidence explicitly supersedes them.
