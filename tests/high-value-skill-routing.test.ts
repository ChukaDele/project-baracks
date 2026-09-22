import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSkills } from '../src/skills/resolver.js';

const priorMajorHome = process.env.MAJOR_HOME;
const priorRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorEvals = process.env.MAJOR_SKILLS_EVALS;
const home = mkdtempSync(join(tmpdir(), 'major-high-value-routing-'));

beforeEach(() => {
  process.env.MAJOR_HOME = home;
  process.env.MAJOR_SKILLS_REGISTRY = join(process.cwd(), 'guidance', 'skills.registry.json');
  process.env.MAJOR_SKILLS_EVALS = join(process.cwd(), 'evals', 'skill-resolver');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorRegistry;
  if (priorEvals === undefined) delete process.env.MAJOR_SKILLS_EVALS;
  else process.env.MAJOR_SKILLS_EVALS = priorEvals;
});

interface Case {
  name: string;
  task: string;
  include: string[];
  exclude?: string[];
}

const cases: Case[] = [
  {
    name: 'technical SOP',
    task: 'Turn these rough operating notes into a clear SOP with warnings, steps, and acceptance checks.',
    include: ['writing-os', 'technical-writing', 'asd-ste100', 'prose-craft'],
    exclude: ['product-management-core', 'concept-synthesis', 'knowledge-ingest'],
  },
  {
    name: 'personal brand post',
    task: 'Turn these ideas into a LinkedIn post that strengthens my operator personal brand without sounding generic.',
    include: ['writing-os', 'personal-brand-strategy', 'prose-craft', 'natural-writing-qa'],
    exclude: ['observability', 'brand-strategy'],
  },
  {
    name: 'pitch deck creation',
    task: 'Create a ten slide investor pitch deck from this brief with a strong storyline and premium minimalist design.',
    include: ['presentation-storylining', 'design-direction-and-taste'],
    exclude: ['codebase-design', 'engineering-design-doctrine', 'auth-security'],
  },
  {
    name: 'deck review',
    task: 'Review this presentation for hierarchy, spacing, narrative flow, visual consistency and overlapping text, then fix it.',
    include: ['presentation-storylining', 'design-direction-and-taste', 'cross-modal-review'],
    exclude: ['auth-security', 'exact-head-pr-review'],
  },
  {
    name: 'landing page redesign',
    task: 'Redesign this landing page so it feels premium, distinctive, responsive and not generic.',
    include: ['design-direction-and-taste', 'remote-first-web-development'],
    exclude: ['direct-response-writing', 'security-audit'],
  },
  {
    name: 'new web app',
    task: 'Build a new recruiter web app from this brief with auth, roles, dashboard, and production-ready UX.',
    include: [
      'project-start',
      'mvp-speed-prioritisation',
      'product-management-core',
      'prior-art-discovery',
      'auth-security',
      'remote-first-web-development',
    ],
    exclude: ['analytics-with-shaper', 'incident', 'ci-recovery'],
  },
  {
    name: 'existing UI review',
    task: 'Audit this existing web app UI and identify what feels boxy, generic, confusing, or inconsistent.',
    include: ['website-design-qa', 'design-direction-and-taste'],
    exclude: ['security-audit', 'skill-harvest', 'skill-resolver'],
  },
  {
    name: 'open source first',
    task: 'Before we build this workflow engine, find mature open-source implementations we can adopt or wrap.',
    include: ['open-source-leverage', 'prior-art-discovery'],
    exclude: ['learning-capture', 'research-compendium'],
  },
  {
    name: 'application bug',
    task: 'The app is stuck in a login loop and candidate search is broken. Find the root cause and fix it.',
    include: ['root-cause-qa', 'debugging', 'auth-security'],
    exclude: ['exact-head-pr-review', 'data-learning-loop'],
  },
  {
    name: 'browser QA',
    task: 'QA the web app in a real browser as a recruiter. Test the critical flows and fix issues you find.',
    include: ['browser-release-qa', 'website-design-qa'],
    exclude: ['academic-writing', 'academic-verify'],
  },
  {
    name: 'named source analysis',
    task: 'Deeply analyze this article and extract useful mechanisms, examples, contradictions and implications for our Writing OS.',
    include: ['source-ingestion', 'strategic-reading'],
    exclude: ['writing-os', 'academic-writing', 'browser-release-qa'],
  },
  {
    name: 'market research',
    task: 'Research the market and competitors, synthesize the evidence, and recommend the strongest product opportunity.',
    include: ['knowledge-work', 'competitive-product-audit', 'product-management-core'],
    exclude: ['browser-release-qa', 'capability-freshness', 'cross-modal-review'],
  },
  {
    name: 'SEO',
    task: 'Audit this website SEO, content architecture, technical issues and search growth opportunities.',
    include: ['seo-os'],
    exclude: ['security-audit', 'technical-writing'],
  },
  {
    name: 'security review',
    task: 'Review this SaaS application security posture including authentication, permissions, secret handling and data access controls.',
    include: ['security-audit', 'auth-security'],
    exclude: ['exact-head-pr-review', 'cross-modal-review'],
  },
  {
    name: 'valuation',
    task: 'Build a valuation and acquisition analysis for this target company using comparable companies, cash flow, leverage and downside cases.',
    include: ['valuation-investment-ma'],
    exclude: ['auth-security', 'root-cause-qa'],
  },
  {
    name: 'PDF report',
    task: 'Create a polished client-facing PDF report from this analysis and verify pagination, layout and readability.',
    include: ['pdf-reporting-qa'],
    exclude: ['root-cause-qa'],
  },
  {
    name: 'knowledge ingest',
    task: 'Ingest this transcript into our knowledge system with provenance and extract reusable concepts.',
    include: ['knowledge-ingest'],
    exclude: ['skill-harvest', 'behavior-reward-system'],
  },
  {
    name: 'new product project',
    task: 'I have a new product idea. Set up the best project shape and fastest credible MVP using our reusable templates.',
    include: [
      'project-start',
      'mvp-speed-prioritisation',
      'product-management-core',
      'prior-art-discovery',
    ],
    exclude: ['idea-lineage', 'domain-modeling'],
  },
  {
    name: 'Vercel deploy',
    task: 'Deploy this Next.js app to Vercel, verify environment variables, and test the production preview.',
    include: ['remote-first-web-development', 'browser-release-qa'],
    exclude: ['academic-verify'],
  },
  {
    name: 'YouTube source',
    task: 'Analyze this YouTube video in full. Get the transcript and use the actual source rather than summaries.',
    include: ['source-ingestion', 'strategic-reading'],
    exclude: ['open-source-leverage', 'source-adapter-engineering'],
  },
  {
    name: 'writing critique',
    task: 'Critically evaluate this essay for thesis, evidence, specificity, reasoning, voice and source fidelity.',
    include: ['writing-evaluator'],
    exclude: ['browser-release-qa', 'capability-freshness', 'cross-modal-review'],
  },
  {
    name: 'operations improvement',
    task: 'Map this operations workflow, find bottlenecks, automation opportunities, control gaps and the best improvement sequence.',
    include: ['operations-improvement-core'],
    exclude: ['learning-capture', 'cost-control'],
  },
  {
    name: 'auth implementation',
    task: 'Implement secure login, signup, roles, permissions, password recovery and session handling for this web app.',
    include: ['auth-security', 'prior-art-discovery'],
    exclude: ['incident', 'ci-recovery'],
  },
  {
    name: 'browser debugging',
    task: 'Use the browser to reproduce this frontend issue, inspect console errors and verify the fix.',
    include: ['root-cause-qa', 'debugging', 'browser-release-qa'],
    exclude: ['academic-verify'],
  },
  {
    name: 'responsive motion',
    task: 'Build this responsive scroll-driven hero with GSAP, sticky scenes and mobile fallbacks.',
    include: ['responsive-motion-systems', 'website-design-qa', 'remote-first-web-development'],
    exclude: ['academic-writing'],
  },
  {
    name: 'PR code review',
    task: 'Review this pull request for correctness, regressions, maintainability, tests and release readiness.',
    include: ['review', 'exact-head-pr-review'],
    exclude: ['browser-release-qa', 'cross-modal-review'],
  },
  {
    name: 'legacy and workspace cleanup',
    task: 'Clean up obsolete legacy code, duplicate configs, stale dependencies and redundant local project copies.',
    include: ['legacy-cleanup', 'workspace-lifecycle-management'],
    exclude: ['concept-synthesis'],
  },
  {
    name: 'read PDF source',
    task: 'Read this PDF and tell me the key findings.',
    include: ['source-ingestion', 'strategic-reading'],
    exclude: ['pdf-reporting-qa'],
  },
  {
    name: 'explicitly negated PDF output stays source analysis',
    task: 'Read this PDF and explain the argument. Do not create a PDF.',
    include: ['source-ingestion', 'strategic-reading'],
    exclude: ['pdf-reporting-qa'],
  },
  {
    name: 'filesystem permissions are not auth',
    task: 'Review file permissions on this folder.',
    include: [],
    exclude: ['auth-security', 'security-audit'],
  },
  {
    name: 'nontechnical stuck is not debugging',
    task: 'I am stuck choosing between two product strategies.',
    include: [],
    exclude: ['root-cause-qa', 'debugging'],
  },
  {
    name: 'SQL bottleneck is not operations redesign',
    task: 'Find the bottleneck in this SQL query.',
    include: [],
    exclude: ['operations-improvement-core'],
  },
  {
    name: 'human auth blocker',
    task: 'We need OAuth consent and 2FA before this deployment can continue.',
    include: ['human-blocker-orchestration'],
    exclude: ['academic-writing'],
  },
  {
    name: 'vulnerability wording reaches security audit',
    task: 'Audit vulnerabilities in this SaaS application.',
    include: ['security-audit'],
    exclude: ['academic-writing'],
  },
  {
    name: 'frontend code review is not visual QA',
    task: 'Review this frontend code for correctness.',
    include: ['review'],
    exclude: ['website-design-qa'],
  },
  {
    name: 'negated redesign keeps code review focused and preserves performance specialist',
    task: 'Review this frontend code for correctness and performance. I am not asking for a visual redesign.',
    include: ['review', 'performance'],
    exclude: ['website-design-qa', 'design-direction-and-taste'],
  },
  {
    name: 'visual browser QA stays remote first',
    task: 'Review this landing page visually across mobile and desktop in the browser.',
    include: ['website-design-qa', 'browser-release-qa', 'remote-first-web-development'],
    exclude: ['exact-head-pr-review'],
  },
];

describe('high-value canonical skill routing', () => {
  it.each(cases)('$name', ({ task, include, exclude = [] }) => {
    const ids = resolveSkills({ task }).skills.map((skill) => skill.id);
    for (const id of include) expect(ids, task).toContain(id);
    for (const id of exclude) expect(ids, task).not.toContain(id);
  });
});
