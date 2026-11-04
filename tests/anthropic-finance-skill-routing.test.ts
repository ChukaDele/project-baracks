import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSkills } from '../src/skills/resolver.js';

const priorEnv = {
  MAJOR_HOME: process.env.MAJOR_HOME,
  MAJOR_SKILLS_REGISTRY: process.env.MAJOR_SKILLS_REGISTRY,
  MAJOR_SKILLS_EVALS: process.env.MAJOR_SKILLS_EVALS,
  MAJOR_SHARED_SKILLS_ROOT: process.env.MAJOR_SHARED_SKILLS_ROOT,
};
const home = mkdtempSync(join(tmpdir(), 'major-finance-routing-'));

beforeEach(() => {
  process.env.MAJOR_HOME = home;
  process.env.MAJOR_SKILLS_REGISTRY = join(process.cwd(), 'guidance', 'skills.registry.json');
  process.env.MAJOR_SKILLS_EVALS = join(process.cwd(), 'evals', 'skill-resolver');
  process.env.MAJOR_SHARED_SKILLS_ROOT = join(process.cwd(), 'tests', 'fixtures', 'shared-skills');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ids = (task: string) => resolveSkills({ task }).skills.map((skill) => skill.id);

const finance = new Set([
  'client-report',
  'client-review',
  'investment-proposal',
  'dcf-model',
  'lbo-model',
  '3-statement-model',
  'comps-analysis',
  'merger-model',
  'returns-analysis',
  'audit-xls',
  'clean-data-xls',
  'competitive-analysis',
  'deck-refresh',
  'ib-check-deck',
  'pitch-deck',
  'ppt-template-creator',
  'xlsx-author',
  'pptx-author',
  'earnings-analysis',
  'earnings-preview',
  'initiating-coverage',
  'morning-note',
  'thesis-tracker',
  'catalyst-calendar',
  'idea-generation',
  'sector-overview',
  'model-update',
  'cim-builder',
  'teaser',
  'buyer-list',
  'process-letter',
  'datapack-builder',
  'strip-profile',
  'deal-tracker',
  'deal-screening',
  'deal-sourcing',
  'dd-checklist',
  'dd-meeting-prep',
  'ic-memo',
  'portfolio-monitoring',
  'unit-economics',
  'value-creation-plan',
  'ai-readiness',
  'gl-recon',
  'break-trace',
  'accrual-schedule',
  'nav-tieout',
  'roll-forward',
  'variance-commentary',
  'kyc-doc-parse',
  'kyc-rules',
]);

describe('Anthropic finance specialists at the default resolver limit', () => {
  it.each([
    ['Build a DCF model for this company with WACC and terminal value sensitivity.', 'dcf-model'],
    ['Complete this LBO model template in Excel for the sponsor case.', 'lbo-model'],
    ['Populate this 3-statement model template and link the balance sheet.', '3-statement-model'],
    ['Build a comparable company analysis with peer multiples.', 'comps-analysis'],
    ['Build an accretion and dilution analysis for this acquisition.', 'merger-model'],
    ['Build an IRR and MOIC sensitivity table across entry multiples.', 'returns-analysis'],
    ['Audit this financial model workbook for formula errors.', 'audit-xls'],
    ['Clean up this messy Excel spreadsheet and fix numbers stored as text.', 'clean-data-xls'],
    ['Build a competitive landscape deck for this sector.', 'competitive-analysis'],
    ['Refresh this deck with the new quarterly numbers.', 'deck-refresh'],
    ['QC this investment banking deck before it goes to the client.', 'ib-check-deck'],
    ['Populate this investment banking pitch deck from the source files.', 'pitch-deck'],
    ['Turn this PowerPoint template into a reusable skill.', 'ppt-template-creator'],
    ['Produce the workbook headless as an xlsx file artifact.', 'xlsx-author'],
    ['Produce the slides headless as a pptx file artifact.', 'pptx-author'],
    ["Write an earnings update report on this quarter's results.", 'earnings-analysis'],
    ['Build an earnings preview with bull and bear scenarios.', 'earnings-preview'],
    ['Write an initiating coverage report on this stock.', 'initiating-coverage'],
    ['Draft the morning note on overnight developments.', 'morning-note'],
    ['Update the investment thesis tracker for this position.', 'thesis-tracker'],
    ['Build a catalyst calendar across my coverage universe.', 'catalyst-calendar'],
    ['Run a stock screen and shortlist investment ideas.', 'idea-generation'],
    ['Write a sector overview of West African agribusiness.', 'sector-overview'],
    ['Update the financial model for the new earnings and guidance.', 'model-update'],
    ['Draft a confidential information memorandum for this sale.', 'cim-builder'],
    ['Draft an anonymous company teaser for this process.', 'teaser'],
    ['Build a buyer list of strategic acquirers.', 'buyer-list'],
    ['Draft the process letter with bid instructions.', 'process-letter'],
    ['Build a data pack from this offering memorandum.', 'datapack-builder'],
    ['Create a strip profile of this company.', 'strip-profile'],
    ['Set up a deal tracker for our live deals.', 'deal-tracker'],
    ['Screen this inbound deal flow against our fund criteria.', 'deal-screening'],
    ['Run deal sourcing for founder-owned targets.', 'deal-sourcing'],
    ['Generate a due diligence checklist for this target.', 'dd-checklist'],
    ['Prepare for the expert network call in this due diligence.', 'dd-meeting-prep'],
    ['Draft the investment committee memo for this deal.', 'ic-memo'],
    ["Run portfolio monitoring on this quarter's numbers.", 'portfolio-monitoring'],
    ['Analyze the unit economics and LTV/CAC of this target.', 'unit-economics'],
    ['Structure a value creation plan for this acquisition.', 'value-creation-plan'],
    ['Scan the portfolio for AI readiness opportunities.', 'ai-readiness'],
    ['Reconcile the general ledger to the subledger for this period.', 'gl-recon'],
    ['Root-cause this reconciliation break to its source posting.', 'break-trace'],
    ['Build the period-end accrual schedule.', 'accrual-schedule'],
    ['Tie this LP statement to the NAV pack.', 'nav-tieout'],
    ['Build a roll-forward schedule for this balance sheet account.', 'roll-forward'],
    ['Write variance commentary for every P&L line over threshold.', 'variance-commentary'],
    ['Parse this KYC onboarding packet into structured fields.', 'kyc-doc-parse'],
    ['Apply the KYC rules grid and assign a risk rating.', 'kyc-rules'],
  ])('%s -> %s', (task, skill) => {
    expect(ids(task)).toContain(skill);
  });

  it('keeps the existing valuation route alongside the specialist', () => {
    expect(ids('Build a DCF model for this company')).toEqual(
      expect.arrayContaining(['valuation-investment-ma', 'dcf-model']),
    );
  });

  it.each([
    'Rotate the API keys.',
    'Fix the sticky header on the marketing website.',
    'Build a pitch deck for my startup seed round',
    'Review my seed pitch deck',
    'Use this pitch deck template for my startup',
    'Add navigation to the admin dashboard',
    'Reconcile the two database schemas',
    'Write a morning routine checklist',
    'Roll forward the account table migration',
    'Root-cause the checkout break',
    'Implement KYC rules validation in the Express API',
    'Clean up the Excel export code in the React component',
    'Strip profile fields from the API response before logging',
    'Add MTN data pack purchase to the checkout flow',
    'Add a net retention card to the analytics dashboard',
    'Build the buyer list page in the marketplace admin',
    'Parse 3 statement PDFs from the bank',
    'Update the model routing guidance',
    'Show dd/mm/yyyy dates in the meeting scheduler',
    'Add a loading state to the screen listing our deals',
    'Build the stock screen for the inventory app',
    'Build the driver earnings report screen',
    'Use the competitive analysis to update the product roadmap',
    'Use the deal tracker API in the React dashboard and fix the auth bug',
    'Apply the model update to fix the broken deploy',
    'Run the model update migration',
    'Use teaser images on the landing page',
    'Apply roll-forward to the failed migration',
    'Load the buyer list from the CSV into Postgres',
    'WebSocket reconnect breaks on mobile Safari',
    'Fix the bug where the nav icon pack fails to load',
    'Fix the failing migration tests in the gl reconnect module',
    'Refresh the presentation layer so it formats numbers correctly',
    'Audit this financial model for security issues',
    'Build a DCF calculator landing page',
    'Plan the 100-day plan for our new CTO',
    'Clean up the React component',
    'Tie the sidebar to the nav',
    'Tie this link to the nav bar',
    'Review this teaser trailer',
    'Triage the teaser backlog',
    'Run a variance analysis on the A/B test results',
    'Run a flux analysis on the magnetic field data',
    'Summarize Q3 results of our marketing campaign',
    'Plan a Q4 results webinar',
    'Add KYC document upload to the signup form',
    'Generate the customer report for this client',
    'Review the client feedback from the meeting',
  ])('does not route unrelated work: %s', (task) => {
    expect(ids(task).filter((id) => finance.has(id))).toEqual([]);
  });

  it.each([
    ['Build a discounted cash flows model', 'dcf-model'],
    ['Build the month-end accruals schedule', 'accrual-schedule'],
    ['Write the flux analysis for October', 'variance-commentary'],
    ['Tie out the NAV to the administrator statement', 'nav-tieout'],
    ['Run comps on these three companies', 'comps-analysis'],
    ['Build a merger analysis with pro forma EPS', 'merger-model'],
    ['Update the pitchbook with new comps', 'pitch-deck'],
    ["Check my formulas, the model won't balance", 'audit-xls'],
    ['Prepare an offering memorandum for the sale', 'cim-builder'],
    ['Summarize the Q3 earnings call', 'earnings-analysis'],
    ['Pull the KPIs for our portcos', 'portfolio-monitoring'],
    ['Prepare a diligence checklist for this target', 'dd-checklist'],
    ['Write the investment memo for IC', 'ic-memo'],
    ['Screen this CIM against our fund criteria', 'deal-screening'],
    ['Update the model\nfor the new earnings', 'model-update'],
    ['Analyze the unit economics of this subscription app', 'unit-economics'],
    ['Build a DCF model for a food delivery app', 'dcf-model'],
    ['Reconcile the GL to the subledger by cost code', 'gl-recon'],
    ['Write variance commentary by GL code', 'variance-commentary'],
    ['Tie this LP statement to the NAV pack on page 4', 'nav-tieout'],
    ['Audit the formulas on page 3 of this financial model', 'audit-xls'],
    ['NAV tie-out by security for October', 'nav-tieout'],
    ['Write an IC memo on this asset-backed security', 'ic-memo'],
    ['Update the LP statement for capital deployed this quarter', 'nav-tieout'],
    ['Run portfolio monitoring and refresh the dashboard', 'portfolio-monitoring'],
    ['Build a 3-statement model with an inventory schedule', '3-statement-model'],
    ['Build an accrual schedule for the database hosting contract', 'accrual-schedule'],
    ['Do the unit economics for this feature', 'unit-economics'],
    ['Check the workbook, the third tab has a bug in the WACC formula', 'audit-xls'],
    ['Run a KYC risk rating on this app user', 'kyc-rules'],
    ['Prepare the client performance report for this quarter.', 'client-report'],
    ['Prepare for the client review meeting next week.', 'client-review'],
    ['Draft an investment proposal for this client.', 'investment-proposal'],
    ['Draft a CIM for an app company', 'cim-builder'],
    ['Build a comps table for cloud security companies', 'comps-analysis'],
    ['Write an earnings update report on CrowdStrike security revenue', 'earnings-analysis'],
    ['Sector overview of the fintech app market', 'sector-overview'],
    ['Create a strip profile for this security company', 'strip-profile'],
  ])('routes ordinary finance phrasing: %s -> %s', (task, skill) => {
    expect(ids(task)).toContain(skill);
  });

  it.each([
    ['Roll forward the account table migration', 'migration'],
    ['Root-cause the checkout break', 'root-cause-qa'],
    ['Implement KYC rules validation in the Express API', 'api'],
    ['Parse 3 statement PDFs from the bank', 'reconciliation-close-statements'],
    ['Run the model update migration', 'migration'],
    ['Reconcile the GL to the subledger for October', 'reconciliation-close-statements'],
  ])('keeps existing skills: %s -> %s', (task, skill) => {
    expect(ids(task)).toContain(skill);
  });

  it('adds the guide and keeps other skills when only the finance route matches', () => {
    const route = ids('Write the investment committee memo and draft the strategy');
    expect(route).toEqual(expect.arrayContaining(['finance-skills-routing', 'ic-memo']));
  });

  it('needs the word skill to name a route-only id in prose', () => {
    expect(ids('Use the deal tracker API and fix the auth bug')).not.toContain('deal-tracker');
    expect(ids('Use the deal-tracker skill for this mandate')).toEqual(['deal-tracker']);
  });
});
