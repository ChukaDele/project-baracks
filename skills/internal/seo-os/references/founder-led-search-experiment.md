# Founder-led search experiment: operational playbook

**Source pattern:** Eric Siu's 3 October 2026 Instagram Reel about Cody Schneider's webinar demonstration of a LinkedIn article reportedly appearing first for one narrow Google query after 38 minutes. The result was on LinkedIn, not a new independent website, and is one observed test without verified conversions. Source: https://www.instagram.com/reel/DeDJ28UgAx_/ .

**Decision:** Reuse narrow-query research, ranked-page analysis, founder-evidence interviews, editorial review and post-publication verification. Do not promise fast rankings, copy competitors, manipulate indexing or use borrowed platform authority as a substitute for the owner's site.

## Workflow and gates

1. **Outcome and context.** Resolve domain, audience, service, market, conversion goal and existing money page. Retrieve maintained Notion knowledge and project SEO context. For established sites, inspect Search Console opportunities before generic keywords. Do not treat raw ContextBolt saves as curated authority.
2. **One search intent.** Inspect live SERP URLs for an exact query in a documented market/device/date and record intent, gaps and competing surfaces. Distinguish observed relevant articles from verified ranking positions. If ranking/demand were not measured, label them unknown.
3. **Research.** Study 2–5 relevant primary/competitor sources, with URLs, dates, key claims and limitations. Summarise original insights; do not copy page bodies or spin them into variants.
4. **Firsthand source.** Ground the piece in the owner's own documented work or a brief interview about decisions, mistakes, tradeoffs and lessons. Tag numbers, direct quotes and client details as approved, uncertain or confidential. No invented proof.
5. **Owned-site asset.** Prefer improving an indexable relevant page before creating another. Answer the user intent with original evidence, a coherent structure, useful internal links and an appropriate CTA. Ensure title, description, self-canonical, sitemap, crawl access and rendered readability. Keep unapproved drafts noindex.
6. **LinkedIn adaptation.** Write an intentionally different article with a distinctive opening and useful point of view. Link to the most relevant owned-site article/case. Do not duplicate whole articles or imply LinkedIn's rank belongs to the site.
7. **Editorial approval.** The owner must approve personal voice, public case details, conversion claims, client disclosure, CTA, distribution and publication. Before approval, only research, drafts and technical checks are automatic. Publishing/paid indexing/promotions are not autonomous.
8. **Publish and verify.** After approval, publish and independently visit each public URL, check HTTP 200, canonical/robots/indexability/sitemap/internal links and mobile rendering. Search Console may request ordinary recrawl; avoid unsupported third-party fast-indexers or Google's Indexing API for ordinary articles.
9. **Measure.** Record actual URLs, publication date, 7/30-day query/page GSC impressions, clicks, CTR, position, relevant leads and channel referrals. Put unavailable metrics as unknown. Compare traffic quality and leads against baseline; avoid causal claims from one ranking screenshot.

## Reusable CLI proof

From the Major repo, run:
`node scripts/seo-content-experiment.mjs path/to/experiment.json --live --out /tmp/seo-experiment-output`

The input file declares `id`, `siteUrl`, `targetUrl`, `targetQuery`, `audience`, `businessOutcome`, `market`, `intentHypothesis`, `observedSources[]`, `firsthandEvidence[]`, and `approval`. Sources have `url`, `role`, `observation`, `checkedAt`; evidence has `claim`, `sourceUrl`, `visibility`, `verified`.

Outputs: `brief.md` and `preflight.json` with gate status and live technical observations. The input may contain claimed approvals; this CLI never authenticates an approver or authorizes publishing. Dry-run success is **not** proof of publication, Google indexing, LinkedIn rankings, Search Console traffic or enquiries. Claim a launch only after approved published URLs are reachable.

## Independent challenge

Before declaring success check original value without Google; evidence and client permission; exact observed SERP vs guess; differentiation; unique LinkedIn adaptation; crawlability and canonical; unbiased ranking verification; and attributable leads.

## References

- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/apis/indexing-api/v3/using-api
- https://developers.google.com/search/docs/crawling-indexing/canonicalization
