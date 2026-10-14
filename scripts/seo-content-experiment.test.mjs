import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateExperiment,
  inspectLive,
  preparePackage,
  googlebotAllowed,
} from './seo-content-experiment.mjs';
import { spawnSync } from 'node:child_process';

const fixture = JSON.parse(
  readFileSync(new URL('../examples/seo-chukadele-surface-talent.json', import.meta.url), 'utf8'),
);
const base = () => structuredClone(fixture);
const makeFetch =
  (opts = {}) =>
  async (url, init) => {
    const path = new URL(url).pathname;
    const target = '/work-surface-talent.html';
    if (opts.redirect && path === target) {
      assert.equal(init.redirect, 'manual');
      return new Response(null, {
        status: 301,
        headers: { Location: 'https://chukadele.com/work.html' },
      });
    }
    const body =
      '<!doctype html><html><head>' +
      (opts.missingTitle ? '' : '<title>Surface Talent</title>') +
      '<link rel="canonical" href="' +
      (opts.wrongCanonical
        ? 'https://chukadele.com/work.html'
        : 'https://chukadele.com/work-surface-talent.html') +
      '">' +
      (opts.noindex ? '<meta name="robots" content="noindex">' : '') +
      (opts.googlebotNoindex ? '<meta name="googlebot" content="none">' : '') +
      '</head><body>' +
      (opts.multiH1 ? '<h1>A</h1><h1>B</h1>' : '<h1>Surface Talent</h1>') +
      '<p>role and candidate evidence</p></body></html>';
    const bodies = {
      [target]: body,
      '/notes.html':
        '<html><head><title>Notes</title></head><body><p>responsibilities and achievements</p></body></html>',
      '/robots.txt':
        opts.robots ?? 'User-agent: *\nAllow: /\nSitemap: https://chukadele.com/sitemap.xml\n',
      '/sitemap.xml':
        '<?xml version="1.0"?><urlset><url><loc>https://chukadele.com/</loc></url>' +
        (opts.missingSitemap
          ? ''
          : '<url><loc>https://chukadele.com/work-surface-talent.html</loc></url>') +
        '</urlset>',
    };
    if (!(path in bodies)) throw new Error('unexpected fetch: ' + url);
    return new Response(bodies[path], {
      status: 200,
      headers: {
        'content-type': 'text/html',
        ...(opts.xRobots && path === target ? { 'x-robots-tag': opts.xRobots } : {}),
      },
    });
  };

test('accepts two observed sources and genuine public operator evidence', () => {
  const data = validateExperiment(base(), '2026-10-14');
  assert.equal(data.errors.length, 0);
  const p = preparePackage(data);
  assert.equal(p.gate, 'ready-for-editorial-review');
  assert.match(p.markdown, /not verified Google rank/);
  assert.match(p.markdown, /unknown \| pending \| pending/);
  assert.match(p.markdown, /Publishing is a deliberate owner action/);
});

test('gates fail closed on stale evidence, private-only evidence, and duplicate sources', () => {
  const doc = base();
  doc.observedSources[0].checkedAt = '2026-06-01';
  doc.observedSources[1] = { ...doc.observedSources[0] };
  doc.firsthandEvidence = [{ ...doc.firsthandEvidence[0], visibility: 'private' }];
  doc.approval = { editorial: true, clientClearance: true };
  const data = validateExperiment(doc, '2026-10-14');
  assert.ok(data.errors.length >= 3);
  const output = preparePackage(data);
  assert.equal(output.gate, 'blocked');
  assert.doesNotMatch(output.markdown, /The Surface Talent working note describes/);
});

test('rejects off-domain, insecure and local URLs', () => {
  for (const url of [
    'http://chukadele.com/notes.html',
    'https://localhost/notes.html',
    'https://another-site.com/notes.html',
    'https://127.0.0.1/notes.html',
  ]) {
    const doc = base();
    doc.targetUrl = url;
    assert.throws(() => validateExperiment(doc, '2026-10-14'));
  }
});

test('live check verifies title/canonical/H1/robots/sitemap together', async () => {
  const data = validateExperiment(base(), '2026-10-14');
  const report = await inspectLive(data, makeFetch());
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.checks.sitemapIncludesTarget, true);
  assert.equal(report.checks.canonicalSelf, true);
  assert.equal(preparePackage(data, report).status, 'live-preflight-passed');
});

test('live check refuses noindex or missing sitemap entry', async () => {
  const data = validateExperiment(base(), '2026-10-14');
  for (const opts of [{ noindex: true }, { missingSitemap: true }]) {
    const report = await inspectLive(data, makeFetch(opts));
    assert.equal(report.passed, false);
    assert.equal(preparePackage(data, report).gate, 'blocked');
  }
});

test('robots decisions enforce Googlebot groups and longest path rule', () => {
  const path = '/work-surface-talent.html';
  assert.equal(googlebotAllowed('User-agent: Googlebot\nDisallow: /\n', path), false);
  assert.equal(
    googlebotAllowed('User-agent: *\nDisallow: /work-surface-talent.html\n', path),
    false,
  );
  assert.equal(googlebotAllowed('User-agent: *\nCrawl-delay: 1\nDisallow: /\n', path), false);
  assert.equal(
    googlebotAllowed('User-agent: *\nDisallow: /\nAllow: /work-surface-talent.html\n', path),
    true,
  );
  assert.equal(
    googlebotAllowed('User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /\n', path),
    true,
  );
  assert.equal(googlebotAllowed('User-agent: Googlebot\nDisallow: /private$\n', path), true);
});

test('live rejects Googlebot-specific noindex, robots rules, wrong canonical, redirects and missing title', async () => {
  const data = validateExperiment(base(), '2026-10-14');
  for (const opts of [
    { googlebotNoindex: true },
    { xRobots: 'googlebot: noindex' },
    { robots: 'User-agent: Googlebot\nDisallow: /\n' },
    { robots: 'User-agent: *\nDisallow: /work-surface-talent.html\n' },
    { wrongCanonical: true },
    { redirect: true },
    { missingTitle: true },
    { multiH1: true },
  ]) {
    const report = await inspectLive(data, makeFetch(opts));
    assert.equal(report.passed, false, JSON.stringify(opts));
    assert.equal(preparePackage(data, report).gate, 'blocked');
  }
});

test('unverified or missing source excerpt fails closed and approval booleans cannot authorize publication', async () => {
  const doc = base();
  doc.approval = { editorial: true, clientClearance: true };
  const data = validateExperiment(doc, '2026-10-14');
  assert.equal(preparePackage(data).gate, 'ready-for-editorial-review');
  assert.equal(
    preparePackage(data, await inspectLive(data, makeFetch())).gate,
    'ready-for-editorial-review',
  );
  const fake = base();
  fake.firsthandEvidence[0].sourceExcerpt = 'fabricated result 123456789';
  const failed = await inspectLive(validateExperiment(fake, '2026-10-14'), makeFetch());
  assert.equal(failed.passed, false);
  assert.ok(failed.errors.some((x) => x.includes('excerpt check')));
});

test('URL validation disallows IP literals, trailing local names and unsafe published links', () => {
  for (const url of [
    'https://0.0.0.0/a',
    'https://100.64.0.1/a',
    'https://foo.localhost./a',
    'https://[::1]/a',
  ]) {
    const doc = base();
    doc.firsthandEvidence[0].sourceUrl = url;
    assert.throws(() => validateExperiment(doc, '2026-10-14'));
  }
  const badPublication = base();
  badPublication.publication.linkedinUrl = 'https://bad-linkedin.com/post/1';
  assert.throws(() => validateExperiment(badPublication, '2026-10-14'));
  const badDate = base();
  badDate.observedSources[0].checkedAt = '2026-02-30';
  assert.throws(() => validateExperiment(badDate, '2026-10-14'));
});

test('CLI exits 0 for research-ready package and nonzero for blocked experiment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'major-seo-cli-test-'));
  try {
    const source = join(dir, 'experiment.json');
    const out = join(dir, 'output');
    const runner = new URL('./seo-content-experiment.mjs', import.meta.url).pathname;
    writeFileSync(source, JSON.stringify(base()));
    const ok = spawnSync(process.execPath, [runner, source, '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(
      JSON.parse(readFileSync(join(out, 'preflight.json'))).gate,
      'ready-for-editorial-review',
    );
    const bad = base();
    bad.observedSources[0].checkedAt = '2025-01-01';
    writeFileSync(source, JSON.stringify(bad));
    const blocked = spawnSync(process.execPath, [runner, source, '--out', out], {
      encoding: 'utf8',
    });
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, 'preflight.json'))).gate, 'blocked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
