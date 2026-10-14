#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const today = () => new Date().toISOString().slice(0, 10);
const clean = (value) =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
const getUrl = (value, label) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid ' + label);
  }
  const hostname = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    hostname.endsWith('.') ||
    !hostname.includes('.') ||
    isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 ||
    !/^[a-z0-9.-]+$/.test(hostname) ||
    /(?:^localhost$|\.(?:local|internal|localhost)$)/.test(hostname)
  ) {
    throw new Error('Expected public DNS-hosted HTTPS ' + label);
  }
  return url;
};
const required = (record, key) => {
  if (typeof record?.[key] !== 'string' || !record[key].trim()) throw new Error(`Missing ${key}`);
  return clean(record[key]);
};

export function validateExperiment(data, at = today()) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Expected experiment object');
  const id = required(data, 'id');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('id must be a lowercase slug');
  const site = getUrl(required(data, 'siteUrl'), 'siteUrl');
  const target = getUrl(required(data, 'targetUrl'), 'targetUrl');
  if (site.pathname !== '/' || site.search || site.hash || target.origin !== site.origin)
    throw new Error('targetUrl must belong to the siteUrl origin');
  for (const key of ['targetQuery', 'audience', 'businessOutcome', 'market', 'intentHypothesis'])
    required(data, key);
  if (!Array.isArray(data.observedSources)) throw new Error('observedSources must be an array');
  if (!Array.isArray(data.firsthandEvidence)) throw new Error('firsthandEvidence must be an array');
  const errors = [];
  const research = [];
  for (const [i, source] of data.observedSources.entries()) {
    const url = getUrl(required(source, 'url'), `observedSources[${i}].url`);
    const checkedAt = required(source, 'checkedAt');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) ||
      Number.isNaN(Date.parse(checkedAt)) ||
      new Date(checkedAt).toISOString().slice(0, 10) !== checkedAt
    )
      throw new Error('Invalid source checkedAt');
    const age = (Date.parse(at) - Date.parse(checkedAt)) / 86400000;
    if (age < 0 || age > 30) errors.push(`Source ${url.href} is not freshly verified (0–30 days)`);
    research.push({
      url: url.href,
      role: required(source, 'role'),
      observation: required(source, 'observation'),
      checkedAt,
    });
  }
  if (research.length < 2 || new Set(research.map((x) => x.url)).size < 2)
    errors.push('Review at least two distinct, recently observed relevant sources');
  const evidence = [];
  for (const [i, item] of data.firsthandEvidence.entries()) {
    const visibility = required(item, 'visibility');
    if (!['public', 'client-approved', 'private'].includes(visibility))
      throw new Error('Invalid evidence visibility');
    const sourceUrl =
      visibility === 'private'
        ? null
        : getUrl(required(item, 'sourceUrl'), `firsthandEvidence[${i}].sourceUrl`).href;
    const excerpt = visibility === 'private' ? '' : required(item, 'sourceExcerpt');
    const entry = {
      claim: required(item, 'claim'),
      sourceUrl,
      sourceExcerpt: excerpt,
      visibility,
      verified: item.verified === true,
    };
    evidence.push(entry);
  }
  if (!evidence.some((e) => e.verified && ['public', 'client-approved'].includes(e.visibility)))
    errors.push('No traceable public or client-approved firsthand evidence');
  if (
    evidence.some(
      (e) => e.visibility === 'public' && e.verified && new URL(e.sourceUrl).origin !== site.origin,
    )
  )
    errors.push(
      'Public firsthand proof must be hosted on the owned website or marked client-approved',
    );
  const approval = {
    editorial: data.approval?.editorial === true,
    clientClearance: data.approval?.clientClearance === true,
  };
  const publication = data.publication ?? {};
  if (
    publication.websiteUrl &&
    getUrl(publication.websiteUrl, 'publication.websiteUrl').origin !== site.origin
  )
    throw new Error('Published website URL must use the owned site origin');
  if (
    publication.linkedinUrl &&
    !/(^|\\.)linkedin\\.com$/.test(
      getUrl(publication.linkedinUrl, 'publication.linkedinUrl').hostname,
    )
  )
    throw new Error('Published LinkedIn URL must use linkedin.com');
  return {
    id,
    siteUrl: site.origin,
    targetUrl: target.href,
    targetQuery: clean(data.targetQuery),
    audience: clean(data.audience),
    businessOutcome: clean(data.businessOutcome),
    market: clean(data.market),
    intentHypothesis: clean(data.intentHypothesis),
    research,
    evidence,
    approval,
    publication,
    errors,
  };
}

function extractTags(html, tag) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const safe = head.replace(/<!--[\s\S]*?-->/g, '');
  return [...safe.matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'gi'))].map((m) => m[0]);
}
function attribute(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[1] ?? m[2]).replace(/&amp;/g, '&') : '';
}
export function googlebotAllowed(robotsTxt, path) {
  const groups = [];
  let agents = [],
    rules = [],
    hadRules = false;
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
  };
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const directive = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (directive === 'user-agent') {
      if (hadRules) {
        flush();
        agents = [];
        rules = [];
        hadRules = false;
      }
      agents.push(value.toLowerCase());
    } else if ((directive === 'allow' || directive === 'disallow') && agents.length) {
      rules.push({ allow: directive === 'allow', pattern: value });
      hadRules = true;
    }
  }
  flush();
  const specific = groups.filter((g) => g.agents.includes('googlebot'));
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best = { length: -1, allow: true };
  for (const group of selected) {
    for (const rule of group.rules) {
      if (!rule.pattern) continue;
      const anchored = rule.pattern.endsWith('$');
      const pattern = anchored ? rule.pattern.slice(0, -1) : rule.pattern;
      const escaped = pattern
        .split('*')
        .map((v) => [...v].map((ch) => ('\\.^$+?()[]{}|'.includes(ch) ? '\\' + ch : ch)).join(''))
        .join('.*');
      const reg = new RegExp('^' + escaped + (anchored ? '$' : ''));
      if (!reg.test(path)) continue;
      const length = pattern.replace(/\*/g, '').length;
      if (length > best.length || (length === best.length && rule.allow))
        best = { length, allow: rule.allow };
    }
  }
  return best.allow;
}
async function checkedFetch(url, baseOrigin, fetchImpl) {
  const resp = await fetchImpl(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Major-SEO-Preflight/1.0' },
  });
  if (new URL(resp.url || url).origin !== baseOrigin)
    throw new Error('Off-origin URL during preflight');
  const declaredBytes = Number(resp.headers.get('content-length') || 0);
  if (declaredBytes > 1500000) throw new Error('Page too large for preflight');
  const body = await resp.text();
  if (body.length > 1500000) throw new Error('Page too large for preflight');
  return { status: resp.status, headers: resp.headers, body, finalUrl: resp.url || url };
}
const sourceExcerptFound = (html, excerpt) => {
  const raw = html
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return raw.includes(excerpt.replace(/\s+/g, ' ').trim().toLowerCase());
};
const locsFromSitemap = (body) =>
  [...body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&').trim());
export async function inspectLive(data, fetchImpl = globalThis.fetch) {
  const report = { checkedAt: new Date().toISOString(), passed: false, checks: {}, errors: [] };
  const base = new URL(data.siteUrl);
  const path = new URL(data.targetUrl).pathname;
  try {
    const [page, robots] = await Promise.all([
      checkedFetch(data.targetUrl, base.origin, fetchImpl),
      checkedFetch(new URL('/robots.txt', base).href, base.origin, fetchImpl),
    ]);
    const tags = extractTags(page.body, 'meta');
    const canonicalTags = extractTags(page.body, 'link').filter((tag) =>
      attribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'),
    );
    const canonical =
      canonicalTags.length === 1
        ? new URL(attribute(canonicalTags[0], 'href'), data.targetUrl).href
        : null;
    const robotsMeta = tags
      .filter((tag) => ['robots', 'googlebot'].includes(attribute(tag, 'name').toLowerCase()))
      .map((tag) => attribute(tag, 'content'))
      .join('; ');
    const robotsHeader = page.headers.get('x-robots-tag') ?? '';
    const hasNoindex = /(?:^|[\s,:;])(?:noindex|none)(?=[\s,:;]|$)/i.test(
      robotsMeta + '; ' + robotsHeader,
    );
    const robotsText = robots.body;
    const robotsSitemap = robotsText.match(/^Sitemap:\s*(\S+)/im)?.[1];
    const sitemapUrl = robotsSitemap
      ? new URL(robotsSitemap, base.origin).href
      : new URL('/sitemap.xml', base).href;
    if (new URL(sitemapUrl).origin !== base.origin)
      throw new Error('Sitemap points to another origin');
    const sitemap = await checkedFetch(sitemapUrl, base.origin, fetchImpl);
    let locs = locsFromSitemap(sitemap.body);
    if (sitemap.status === 200 && /<sitemapindex[\s>]/i.test(sitemap.body)) {
      if (locs.length > 10) throw new Error('Sitemap index too large for bounded preflight');
      const nested = [];
      for (const location of locs) {
        const childUrl = new URL(location, sitemapUrl);
        if (childUrl.origin !== base.origin) throw new Error('Sitemap index points off-origin');
        const child = await checkedFetch(childUrl.href, base.origin, fetchImpl);
        if (child.status !== 200) throw new Error('Sitemap child returned non-200');
        nested.push(...locsFromSitemap(child.body));
      }
      locs = nested;
    }
    const title =
      page.body
        .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, ' ')
        .trim() ?? '';
    const h1Count = (page.body.match(/<h1\b/gi) ?? []).length;
    report.checks = {
      pageHttp200: page.status === 200 && page.finalUrl === data.targetUrl,
      canonicalSelf: canonical === data.targetUrl,
      canonicalCount: canonicalTags.length,
      canonical,
      titlePresent: title.length > 0,
      title,
      oneH1: h1Count === 1,
      noNoindex: !hasNoindex,
      robotsHttp200: robots.status === 200,
      robotsAllowsSite: robots.status === 200 && googlebotAllowed(robotsText, path),
      sitemapHttp200: sitemap.status === 200,
      sitemapIncludesTarget: locs.includes(data.targetUrl),
      observedSitemapUrls: locs.length,
      sitemapUrl,
      path,
      evidenceLiveVerified: 0,
    };
    for (const e of data.evidence.filter((e) => e.verified && e.visibility !== 'private')) {
      if (!e.sourceUrl || !e.sourceExcerpt) {
        report.errors.push('Verified evidence is missing source URL or excerpt');
        continue;
      }
      try {
        const src =
          e.sourceUrl === data.targetUrl
            ? page
            : await checkedFetch(e.sourceUrl, new URL(e.sourceUrl).origin, fetchImpl);
        if (src.status !== 200 || !sourceExcerptFound(src.body, e.sourceExcerpt))
          report.errors.push('Verified evidence failed live source/excerpt check: ' + e.sourceUrl);
        else report.checks.evidenceLiveVerified += 1;
      } catch (error) {
        report.errors.push('Evidence source unavailable: ' + e.sourceUrl + ': ' + error.message);
      }
    }
    report.errors.push(
      ...Object.entries(report.checks)
        .filter(
          ([k, v]) =>
            [
              'pageHttp200',
              'canonicalSelf',
              'titlePresent',
              'oneH1',
              'noNoindex',
              'robotsHttp200',
              'robotsAllowsSite',
              'sitemapHttp200',
              'sitemapIncludesTarget',
            ].includes(k) && v !== true,
        )
        .map(([k]) => 'Live check failed: ' + k),
    );
  } catch (error) {
    report.errors.push('Live preflight error: ' + error.message);
  }
  report.passed = report.errors.length === 0;
  return report;
}

export function preparePackage(data, live = null) {
  const blocks = [...data.errors, ...(live?.errors ?? [])];
  // The CLI cannot authenticate owner's approval, even if JSON contains true.
  const gate = blocks.length ? 'blocked' : 'ready-for-editorial-review';
  const status = live
    ? live.passed
      ? 'live-preflight-passed'
      : 'live-preflight-failed'
    : 'live-preflight-not-run';
  const evidenceRows = data.evidence
    .map(
      (e) =>
        `- ${e.visibility === 'private' ? '[PRIVATE: source held outside public brief]' : e.claim + ' | ' + e.sourceUrl + ' | verified: ' + e.verified}`,
    )
    .join('\n');
  const researchRows = data.research
    .map((x) => `- ${x.url} | ${x.role} | checked ${x.checkedAt} | ${x.observation}`)
    .join('\n');
  const publicationWebsite = data.publication.websiteUrl || 'not published';
  const publicationLinkedin = data.publication.linkedinUrl || 'not published';
  const markdown = `# SEO experiment: ${data.id}

**Stage:** ${gate} | **Live technical check:** ${status}

**Query hypothesis:** ${data.targetQuery} (${data.market})
**Audience:** ${data.audience}
**Goal:** ${data.businessOutcome}
**Canonical owned page:** ${data.targetUrl}

## Intent hypothesis
${data.intentHypothesis}

## Observed sources (relevant pages, NOT verified SERP positions)
${researchRows || '- Research needed'}

## Public or client-approved source excerpts (claims need owner review)
${evidenceRows || '- Owner evidence needed'}

## Editorial direction
- Answer the exact searcher problem before explaining your experience.
- Show one specific operating decision from the approved firsthand evidence and what it changed.
- Contrast with sources, acknowledge limitations, link to the canonical page, and end with the relevant next action.
- Draft the owned-page improvement first. Adapt a genuinely distinct LinkedIn article rather than duplicating the full text.
- Do not invent rankings, traffic, metrics, quotations or client outcomes.

## Approval and publication
- Editorial approval in input (NOT authenticated by this tool): ${data.approval.editorial ? 'claimed; manual verification required' : 'no'}
- Client clearance in input (NOT authenticated by this tool): ${data.approval.clientClearance ? 'claimed; manual verification required' : 'no'}
- Owned page: ${publicationWebsite}
- LinkedIn article: ${publicationLinkedin}
- Publishing is a deliberate owner action, never executed by this script.

## Measurement (unknown until connected and observed)
| Measurement | Baseline | Day 7 | Day 30 |
| --- | --- | --- | --- |
| GSC impressions for query/page | unknown | pending | pending |
| GSC clicks / CTR / avg position | unknown | pending | pending |
| Organic landing-page sessions | unknown | pending | pending |
| Qualified enquiries attributable to content | unknown | pending | pending |
| LinkedIn article reach/referrals | unknown | pending | pending |

## Gates to resolve
${blocks.length ? blocks.map((x) => '- ' + x).join('\n') : '- Input completeness and applicable live technical checks passed. Editorial relevance, demand, ownership and permissions still require human review before publication.'}

## Technical results
${live ? JSON.stringify(live.checks, null, 2) : 'Run with --live to check current page/robots/sitemap/canonical state.'}

**External source note:** Ranking/indexing on Google or LinkedIn has not been established by this package. A narrow query can rank briefly and still have negligible demand.
`;
  return { gate, status, blockers: blocks, markdown };
}

async function run() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log(
      'Usage: node scripts/seo-content-experiment.mjs <experiment.json> [--live] [--out <directory>]',
    );
    return;
  }
  const source = args[0];
  const outIdx = args.indexOf('--out');
  if (outIdx >= 0 && !args[outIdx + 1]) throw new Error('--out requires a directory');
  const outputDir = resolve(outIdx >= 0 ? args[outIdx + 1] : `/tmp/major-seo-${Date.now()}`);
  const data = validateExperiment(JSON.parse(await readFile(source, 'utf8')));
  const live = args.includes('--live') ? await inspectLive(data) : null;
  const result = preparePackage(data, live);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'brief.md'), result.markdown);
  await writeFile(
    resolve(outputDir, 'preflight.json'),
    JSON.stringify(
      {
        gate: result.gate,
        status: result.status,
        blockers: result.blockers,
        technical: live,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      outputDir,
      gate: result.gate,
      status: result.status,
      blockers: result.blockers,
    }),
  );
  if (result.gate === 'blocked') process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
