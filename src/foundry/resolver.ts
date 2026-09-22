import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  foundryCatalogSchema,
  foundryManifestSchema,
  type FoundryCatalog,
  type FoundryManifest,
} from './schema.js';

export type FoundryQuestion = {
  id: string;
  priority: 'critical' | 'high' | 'medium';
  question: string;
  why: string;
};

export type FoundryPlan = {
  archetype?: string;
  majorProfile?: 'core' | 'knowledge' | 'web-ui' | 'exploratory' | 'full';
  majorFeatures: string[];
  operatingCore: string[];
  packs: string[];
  optionalPacks: string[];
  modules: string[];
  availableModules: string[];
  deliverables: string[];
  artifacts: string[];
  availableArtifacts: string[];
  deliverableGuidance: Record<
    string,
    {
      purpose: string;
      sections: string[];
      qualityChecks: string[];
      defaultStyle: string;
    }
  >;
  stylePreset: string;
  styleProfile: Record<string, string>;
  domains: string[];
  deploymentTarget?: string;
  uncoveredJurisdictions: string[];
  assumptions: string[];
  questions: FoundryQuestion[];
  firstQuestionBatch: FoundryQuestion[];
};

const PRODUCT_ARCHETYPES = new Set([
  'webapp',
  'mobile-native',
  'backend-service',
  'automation-agent',
  'data-product',
  'content-media',
]);

const UI_ARCHETYPES = new Set([
  'webapp',
  'marketing-site',
  'experience-site',
  'mobile-native',
  'content-media',
]);

const WEB_ARCHETYPES = new Set(['webapp', 'marketing-site', 'experience-site', 'content-media']);

const SERVICE_ARCHETYPES = new Set([
  'webapp',
  'backend-service',
  'automation-agent',
  'data-product',
]);

const EXTERNAL_COMMERCIAL_MODELS = new Set([
  'services',
  'subscription',
  'usage',
  'transaction',
  'marketplace',
  'commerce',
  'advertising',
  'sponsorship',
]);

const DEFAULT_STYLE: Record<string, string> = {
  webapp: 'minimal-system',
  'marketing-site': 'editorial-premium',
  'experience-site': 'cinematic-experience',
  'mobile-native': 'minimal-system',
  'backend-service': 'technical-mono',
  'automation-agent': 'technical-mono',
  'data-product': 'data-dense',
  'library-cli-sdk': 'technical-mono',
  'content-media': 'editorial-premium',
  'knowledge-work': 'consulting-executive',
};

function foundryCatalogPath(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'guidance',
    'foundry',
    'catalog.json',
  );
}

export function loadFoundryCatalog(path = foundryCatalogPath()): FoundryCatalog {
  return foundryCatalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function addQuestion(
  target: FoundryQuestion[],
  id: string,
  priority: FoundryQuestion['priority'],
  question: string,
  why: string,
): void {
  if (!target.some((item) => item.id === id)) {
    target.push({ id, priority, question, why });
  }
}

function riskNeedsJurisdiction(manifest: FoundryManifest): boolean {
  return (
    manifest.risk.regulated ||
    manifest.risk.payments ||
    ['personal', 'special-category', 'financial'].includes(manifest.dataSensitivity ?? '')
  );
}

export function resolveFoundryPlan(rawManifest: unknown, catalog: FoundryCatalog): FoundryPlan {
  const manifest = foundryManifestSchema.parse(rawManifest);
  const packs = new Set<string>();
  const deliverables = new Set<string>(manifest.deliverables);
  const artifacts = new Set<string>();
  const conditionalModules = new Set<string>(manifest.capabilities.requiredModules);
  const conditionalArtifacts = new Set<string>();
  const assumptions = [...manifest.assumptions];
  const questions: FoundryQuestion[] = [];

  const knownBaseOutputs = new Set(
    Object.values(catalog.archetypes).flatMap((archetype) => archetype.defaultDeliverables),
  );
  const genericDeliverables = new Set(['deck', 'document', 'sheet']);
  for (const deliverable of manifest.deliverables) {
    if (
      !genericDeliverables.has(deliverable) &&
      !knownBaseOutputs.has(deliverable) &&
      !catalog.deliverableProfiles[deliverable]
    ) {
      throw new Error(`unknown Foundry deliverable: ${deliverable}`);
    }
  }

  if (!manifest.project.outcome) {
    addQuestion(
      questions,
      'outcome',
      'critical',
      'What concrete outcome should this project make true?',
      'Outcome determines scope and what counts as READY.',
    );
  }

  if (!manifest.project.primaryAudience) {
    addQuestion(
      questions,
      'audience',
      'high',
      'Who is the primary user, buyer, reader or decision-maker?',
      'Audience changes workflow, language, evidence and deliverable structure.',
    );
  }

  if (!manifest.archetype) {
    addQuestion(
      questions,
      'archetype',
      'critical',
      'What are we primarily building: product, site, mobile app, service, agent, data product, package, media product or knowledge artifact?',
      'The base archetype activates the baseline packs and quality gates.',
    );
  } else {
    const archetype = catalog.archetypes[manifest.archetype];
    for (const pack of archetype.packs) packs.add(pack);
    for (const deliverable of archetype.defaultDeliverables) deliverables.add(deliverable);
  }

  for (const pack of manifest.capabilities.required) packs.add(pack);

  if (
    manifest.archetype &&
    ['webapp', 'mobile-native', 'backend-service', 'data-product'].includes(manifest.archetype) &&
    (!manifest.access || manifest.access === 'unknown')
  ) {
    addQuestion(
      questions,
      'access',
      'high',
      'Will this be public, authenticated, mixed, or internal with no external access surface?',
      'Access model changes identity, authorization, abuse controls and release testing.',
    );
  }

  if (manifest.archetype && PRODUCT_ARCHETYPES.has(manifest.archetype)) {
    if (!manifest.dataSensitivity || manifest.dataSensitivity === 'unknown') {
      addQuestion(
        questions,
        'data-sensitivity',
        'high',
        'Will this handle personal, sensitive, financial or otherwise regulated data?',
        'This changes privacy, security, retention and legal obligations.',
      );
    }
  }

  if (
    manifest.archetype === 'automation-agent' &&
    (!manifest.aiRole || manifest.aiRole === 'unknown')
  ) {
    addQuestion(
      questions,
      'ai-autonomy',
      'high',
      'Is this deterministic automation, assistive AI, decision-support AI, or an autonomous agent?',
      'Autonomy changes evals, tool permissions, human approval, fallback and kill-switch requirements.',
    );
  }

  if (manifest.archetype === 'knowledge-work' && manifest.deliverables.length === 0) {
    addQuestion(
      questions,
      'knowledge-deliverable',
      'high',
      'What should this produce: a deck, memo, report, proposal, spreadsheet/model, or another artifact?',
      'Knowledge work needs an explicit output contract; Foundry should not silently assume a report.',
    );
  }

  const businessModel = manifest.businessModel?.toLowerCase() ?? '';
  const isB2b = /b2b|enterprise|business|team/.test(businessModel);
  const hasPersonalData = ['personal', 'special-category', 'financial'].includes(
    manifest.dataSensitivity ?? '',
  );

  if (manifest.access === 'authenticated' || manifest.access === 'mixed') {
    packs.add('identity');
    packs.add('communications');
    packs.add('security');
    conditionalModules.add('verification');
    if (isB2b) {
      for (const module of ['organisations', 'membership', 'rbac', 'admin', 'invites']) {
        conditionalModules.add(module);
      }
    }
  }

  if (hasPersonalData) {
    packs.add('privacy');
    packs.add('security');
    conditionalModules.add('audit-log');
    conditionalModules.add('threat-model');
    conditionalArtifacts.add('runbook.data-rights');
    conditionalArtifacts.add('runbook.breach-response');
    if (manifest.jurisdictions.length > 0) {
      conditionalModules.add('purpose-basis-map');
      conditionalModules.add('sar-dsar');
    }
  }

  if (manifest.risk.regulated) {
    packs.add('legal');
    packs.add('privacy');
    packs.add('security');
    conditionalModules.add('sbom');
    conditionalModules.add('threat-model');
  }

  if (manifest.risk.irreversibleWrites) {
    packs.add('security');
    packs.add('independent-review');
    conditionalModules.add('audit-log');
    conditionalModules.add('threat-model');
  }

  if (
    manifest.commercialModel &&
    EXTERNAL_COMMERCIAL_MODELS.has(manifest.commercialModel) &&
    (['subscription', 'usage', 'transaction', 'marketplace', 'commerce'].includes(
      manifest.commercialModel,
    ) ||
      manifest.access === 'authenticated' ||
      manifest.access === 'mixed')
  ) {
    packs.add('legal');
  }

  if (manifest.risk.payments) {
    packs.add('commercial');
    packs.add('legal');
    packs.add('security');
    for (const module of ['payments', 'invoices', 'tax', 'refunds']) conditionalModules.add(module);
  }

  if (
    ['subscription', 'usage', 'transaction', 'marketplace', 'commerce'].includes(
      manifest.commercialModel ?? '',
    )
  ) {
    packs.add('commercial');
  }

  if (manifest.commercialModel === 'subscription') {
    for (const module of [
      'pricing',
      'plans',
      'subscriptions',
      'entitlements',
      'invoices',
      'customer-portal',
      'cancellation',
      'dunning',
    ]) {
      conditionalModules.add(module);
    }
    conditionalArtifacts.add('document.billing-policy');
    conditionalArtifacts.add('runbook.billing-operations');
  }

  if (manifest.commercialModel === 'usage') {
    for (const module of [
      'pricing',
      'usage-billing',
      'entitlements',
      'invoices',
      'customer-portal',
      'cancellation',
      'dunning',
    ]) {
      conditionalModules.add(module);
    }
    conditionalArtifacts.add('document.billing-policy');
    conditionalArtifacts.add('runbook.billing-operations');
  }

  if (manifest.commercialModel === 'transaction' || manifest.commercialModel === 'marketplace') {
    for (const module of ['pricing', 'payments', 'tax', 'refunds']) conditionalModules.add(module);
    conditionalArtifacts.add('document.billing-policy');
  }

  if (manifest.commercialModel === 'commerce') {
    packs.add('commerce');
  }

  if (manifest.capabilities.required.includes('analytics')) {
    packs.add('analytics');
    if (manifest.archetype && WEB_ARCHETYPES.has(manifest.archetype)) {
      packs.add('legal');
      conditionalModules.add('cookie-policy');
      conditionalArtifacts.add('document.cookie-policy');
    }
  }

  if (hasPersonalData && isB2b) {
    packs.add('legal');
    conditionalModules.add('dpa');
    conditionalModules.add('subprocessor-list');
    conditionalArtifacts.add('document.dpa');
    conditionalArtifacts.add('document.subprocessors');
  }

  if (manifest.aiRole && !['none', 'unknown'].includes(manifest.aiRole)) {
    packs.add('ai');
    if (manifest.aiRole === 'decision-support' || manifest.aiRole === 'autonomous') {
      packs.add('independent-review');
      for (const module of ['confidence', 'human-approval', 'trace-replay']) {
        conditionalModules.add(module);
      }
    }
    if (manifest.aiRole === 'autonomous') {
      for (const module of ['model-routing', 'fallbacks', 'tool-permissions', 'kill-switch']) {
        conditionalModules.add(module);
      }
    }
    if (hasPersonalData) conditionalModules.add('automated-decision-disclosure');
  }

  if (manifest.archetype && UI_ARCHETYPES.has(manifest.archetype)) {
    conditionalModules.add('performance-budget');
    if (WEB_ARCHETYPES.has(manifest.archetype)) {
      conditionalModules.add('browser-qa');
      conditionalModules.add('preview');
      conditionalModules.add('observability-check');
    }
  }

  if (manifest.archetype && SERVICE_ARCHETYPES.has(manifest.archetype)) {
    conditionalModules.add('observability-check');
    if (hasPersonalData) {
      conditionalModules.add('backups');
      conditionalModules.add('restore-drill');
    }
  }

  if (manifest.access === 'authenticated' || manifest.access === 'mixed') {
    conditionalModules.add('csrf');
    conditionalModules.add('rate-limits');
    conditionalModules.add('admin-hardening');
  }

  if (
    (riskNeedsJurisdiction(manifest) || packs.has('legal') || packs.has('privacy')) &&
    manifest.jurisdictions.length === 0
  ) {
    addQuestion(
      questions,
      'jurisdictions',
      'critical',
      'Which countries or regions will the organisation and affected users operate in?',
      'Privacy, consumer, payments and disclosure obligations vary by jurisdiction.',
    );
  }

  if (
    manifest.archetype &&
    [
      'webapp',
      'mobile-native',
      'backend-service',
      'content-media',
      'marketing-site',
      'experience-site',
    ].includes(manifest.archetype) &&
    (!manifest.commercialModel || manifest.commercialModel === 'unknown')
  ) {
    addQuestion(
      questions,
      'commercial-model',
      'medium',
      'Is this internal, free, services-led, subscription, usage-based, transactional, marketplace, commerce, advertising or sponsorship?',
      'Commercial model decides whether billing, entitlements, tax and commercial terms are needed.',
    );
  }

  for (const pack of manifest.capabilities.optional) {
    if (!catalog.packs[pack]) throw new Error(`unknown optional Foundry pack: ${pack}`);
  }

  for (const excluded of manifest.capabilities.excluded) {
    if (!catalog.packs[excluded]) {
      throw new Error(`unknown excluded Foundry pack: ${excluded}`);
    }
    if (packs.has(excluded)) {
      throw new Error(`cannot exclude required Foundry pack '${excluded}'`);
    }
  }

  const allModuleOwners = new Map<string, string[]>();
  for (const [packName, definition] of Object.entries(catalog.packs)) {
    for (const module of [...definition.baselineModules, ...definition.availableModules]) {
      const owners = allModuleOwners.get(module) ?? [];
      owners.push(packName);
      allModuleOwners.set(module, owners);
    }
  }

  for (const module of manifest.capabilities.requiredModules) {
    const owners = allModuleOwners.get(module);
    if (!owners || owners.length === 0) throw new Error(`unknown Foundry module: ${module}`);
    if (!owners.some((owner) => packs.has(owner))) {
      if (owners.length === 1) {
        packs.add(owners[0]!);
      } else {
        throw new Error(
          `module '${module}' requires one of these packs to be active: ${owners.join(', ')}`,
        );
      }
    }
  }

  for (const excluded of manifest.capabilities.excluded) {
    if (packs.has(excluded)) {
      throw new Error(`cannot exclude required Foundry pack '${excluded}'`);
    }
  }

  const baselineModules = new Set<string>();
  const availableModules = new Set<string>();
  const availableArtifacts = new Set<string>();

  for (const pack of packs) {
    const definition = catalog.packs[pack];
    if (!definition) throw new Error(`unknown Foundry pack: ${pack}`);
    for (const module of definition.baselineModules) baselineModules.add(module);
    for (const module of definition.availableModules) availableModules.add(module);
    for (const artifact of definition.baselineArtifacts) artifacts.add(artifact);
    for (const artifact of definition.availableArtifacts) availableArtifacts.add(artifact);
  }

  const modules = new Set<string>(baselineModules);
  for (const module of conditionalModules) {
    const owners = allModuleOwners.get(module);
    if (!owners || owners.length === 0) throw new Error(`unknown Foundry module: ${module}`);
    if (!owners.some((owner) => packs.has(owner))) {
      throw new Error(
        `module '${module}' is required by project facts but none of its packs are active: ${owners.join(', ')}`,
      );
    }
    modules.add(module);
  }

  for (const excluded of manifest.capabilities.excludedModules) {
    if (!allModuleOwners.has(excluded)) {
      throw new Error(`unknown Foundry module: ${excluded}`);
    }
    if (modules.has(excluded)) {
      throw new Error(`cannot exclude required Foundry module '${excluded}'`);
    }
    availableModules.delete(excluded);
  }

  for (const module of modules) availableModules.delete(module);
  for (const artifact of conditionalArtifacts) artifacts.add(artifact);
  for (const artifact of artifacts) availableArtifacts.delete(artifact);

  if (manifest.deliverables.some((item) => ['deck', 'document', 'sheet'].includes(item))) {
    addQuestion(
      questions,
      'deliverable-purpose',
      'high',
      'What decision, action or outcome should the artifact cause for its audience?',
      'Foundry uses that purpose to choose the right deck, document or spreadsheet profile rather than a generic template.',
    );
  }

  const deliverableGuidance = Object.fromEntries(
    [...deliverables]
      .filter((deliverable) => catalog.deliverableProfiles[deliverable])
      .map((deliverable) => [deliverable, catalog.deliverableProfiles[deliverable]!]),
  );

  const firstExplicitDeliverableStyle =
    manifest.archetype === 'knowledge-work'
      ? manifest.deliverables
          .map((deliverable) => catalog.deliverableProfiles[deliverable]?.defaultStyle)
          .find((style): style is string => Boolean(style))
      : undefined;

  const stylePreset =
    manifest.style.preset ??
    firstExplicitDeliverableStyle ??
    (manifest.archetype ? DEFAULT_STYLE[manifest.archetype] : undefined) ??
    'minimal-system';

  const presetStyle = catalog.stylePresets[stylePreset];
  if (!presetStyle) {
    throw new Error(`unknown Foundry style preset: ${stylePreset}`);
  }

  const styleOverrides = Object.fromEntries(
    Object.entries(manifest.style).filter(
      ([key, value]) => key !== 'preset' && value !== undefined,
    ),
  ) as Record<string, string>;
  const styleProfile = { ...presetStyle, ...styleOverrides };

  if (!manifest.style.preset) {
    assumptions.push(
      `style defaults to ${stylePreset} until a stronger brief or reference overrides it`,
    );
  }

  const archetypeDefinition = manifest.archetype
    ? catalog.archetypes[manifest.archetype]
    : undefined;
  const majorFeatures = new Set(archetypeDefinition?.majorFeatures ?? []);
  if (packs.has('security')) majorFeatures.add('security');
  if (manifest.deployment.target?.toLowerCase().includes('vercel')) majorFeatures.add('vercel');

  const optionalPacks = manifest.capabilities.optional
    .filter((pack) => !packs.has(pack) && !manifest.capabilities.excluded.includes(pack))
    .sort();

  const uncoveredJurisdictions = manifest.jurisdictions.filter(
    (jurisdiction) => !catalog.jurisdictions.includes(jurisdiction),
  );
  if (
    uncoveredJurisdictions.length > 0 &&
    (riskNeedsJurisdiction(manifest) || packs.has('legal') || packs.has('privacy'))
  ) {
    assumptions.push(
      `current-source jurisdiction research is required before legal/privacy completion for: ${uncoveredJurisdictions.join(', ')}`,
    );
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2 } as const;
  questions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    ...(manifest.archetype ? { archetype: manifest.archetype } : {}),
    ...(archetypeDefinition ? { majorProfile: archetypeDefinition.majorProfile } : {}),
    majorFeatures: [...majorFeatures].sort(),
    operatingCore: catalog.operatingCore,
    packs: [...packs].sort(),
    optionalPacks,
    modules: [...modules].sort(),
    availableModules: [...availableModules].sort(),
    deliverables: [...deliverables].sort(),
    artifacts: [...artifacts].sort(),
    availableArtifacts: [...availableArtifacts].sort(),
    deliverableGuidance,
    stylePreset,
    styleProfile,
    domains: [...manifest.domains],
    ...(manifest.deployment.target ? { deploymentTarget: manifest.deployment.target } : {}),
    uncoveredJurisdictions,
    assumptions,
    questions,
    firstQuestionBatch: questions.slice(0, 4),
  };
}
