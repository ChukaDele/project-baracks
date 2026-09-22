import { describe, expect, it } from 'vitest';
import { loadFoundryCatalog, resolveFoundryPlan } from '../src/foundry/resolver.js';

const catalog = loadFoundryCatalog();

describe('Foundry headless resolver', () => {
  it('resolves a Surface Talent style webapp into product, privacy and AI packs', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Surface Talent',
          outcome: 'Help recruiters compare candidates using grounded evidence.',
          primaryAudience: 'Recruiters and hiring managers',
        },
        archetype: 'webapp',
        businessModel: 'b2b-saas',
        access: 'authenticated',
        dataSensitivity: 'personal',
        commercialModel: 'services',
        aiRole: 'decision-support',
        jurisdictions: ['uk', 'eu-eea'],
        domains: ['recruitment', 'ai'],
        capabilities: { required: ['integrations', 'data'] },
      },
      catalog,
    );

    expect(plan.packs).toEqual(
      expect.arrayContaining([
        'accessibility',
        'testing-release',
        'operations',
        'identity',
        'communications',
        'privacy',
        'security',
        'ai',
        'independent-review',
        'integrations',
        'data',
      ]),
    );
    expect(plan.artifacts).toContain('document.privacy-notice');
    expect(plan.questions).toEqual([]);
  });

  it('resolves an Awwwards-style experience site without adding auth or billing', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Solar',
          outcome: 'Create a memorable public launch experience.',
          primaryAudience: 'Prospective customers and press',
        },
        archetype: 'experience-site',
        access: 'public',
        dataSensitivity: 'standard',
        commercialModel: 'none',
      },
      catalog,
    );

    expect(plan.packs).toEqual([
      'accessibility',
      'experience-quality',
      'public-web',
      'testing-release',
    ]);
    expect(plan.stylePreset).toBe('cinematic-experience');
    expect(plan.packs).not.toContain('identity');
    expect(plan.packs).not.toContain('commercial');
    expect(plan.questions).toEqual([]);
  });

  it('treats proposal decks as knowledge work plus a deliverable, not a new archetype', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Sponsor Proposal',
          outcome: 'Win a bank sponsor for a university event.',
          primaryAudience: 'Bank partnership and marketing team',
        },
        archetype: 'knowledge-work',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'services',
        deliverables: ['deck.sponsorship', 'document.proposal'],
        style: { preset: 'consulting-executive' },
      },
      catalog,
    );

    expect(plan.packs).toEqual(['independent-review', 'research-provenance']);
    expect(plan.deliverables).toEqual(
      expect.arrayContaining(['deck.sponsorship', 'document.proposal']),
    );
    expect(plan.stylePreset).toBe('consulting-executive');
  });

  it('keeps deterministic automation free of AI-only infrastructure', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Deterministic Automation',
          outcome: 'Move validated records between two systems on a schedule.',
          primaryAudience: 'Operations team',
        },
        archetype: 'automation-agent',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'internal',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.packs).toEqual(
      expect.arrayContaining(['integrations', 'operations', 'security', 'testing-release']),
    );
    expect(plan.packs).not.toContain('ai');
    expect(plan.modules).not.toContain('prompt-registry');
    expect(plan.questions).toEqual([]);
  });

  it('resolves an autonomous agent into safety, eval, integration and review packs', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Compliance Agent',
          outcome: 'Detect consequential regulatory changes and prepare operator updates.',
          primaryAudience: 'Operations team',
        },
        archetype: 'automation-agent',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'internal',
        aiRole: 'autonomous',
      },
      catalog,
    );

    expect(plan.packs).toEqual(
      expect.arrayContaining([
        'ai',
        'independent-review',
        'integrations',
        'operations',
        'security',
        'testing-release',
      ]),
    );
    expect(plan.questions).toEqual([]);
  });

  it('asks only the first four decision-critical questions for an underspecified product', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: { name: 'New Product' },
        archetype: 'webapp',
      },
      catalog,
    );

    expect(plan.questions.map((item) => item.id)).toEqual([
      'outcome',
      'audience',
      'access',
      'data-sensitivity',
      'commercial-model',
    ]);
    expect(plan.firstQuestionBatch.map((item) => item.id)).toEqual([
      'outcome',
      'audience',
      'access',
      'data-sensitivity',
    ]);
  });

  it('adds jurisdiction as a critical question only when the risk profile makes it material', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'People App',
          outcome: 'Manage employee records.',
          primaryAudience: 'HR teams',
        },
        archetype: 'webapp',
        access: 'authenticated',
        dataSensitivity: 'personal',
        commercialModel: 'internal',
      },
      catalog,
    );

    expect(plan.firstQuestionBatch.map((item) => item.id)).toContain('jurisdictions');
  });

  it('attaches type-specific guidance and style to an investor pitch', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Fundraise',
          outcome: 'Raise a seed round.',
          primaryAudience: 'Seed investors',
        },
        archetype: 'knowledge-work',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'none',
        deliverables: ['deck.investor-pitch'],
      },
      catalog,
    );

    expect(plan.deliverableGuidance['deck.investor-pitch']?.sections).toContain('why-now');
    expect(plan.deliverableGuidance['deck.investor-pitch']?.sections).toContain('ask');
    expect(plan.stylePreset).toBe('bold-startup');
  });

  it('asks for artifact purpose when only a generic deck is requested', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Untyped Deck',
          outcome: 'Communicate a project.',
          primaryAudience: 'Stakeholders',
        },
        archetype: 'knowledge-work',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'none',
        deliverables: ['deck'],
      },
      catalog,
    );

    expect(plan.questions.map((item) => item.id)).toContain('deliverable-purpose');
  });

  it('resolves one complete representative manifest for every base archetype', () => {
    for (const archetype of Object.keys(catalog.archetypes)) {
      const isKnowledge = archetype === 'knowledge-work';
      const isPublicUi = [
        'webapp',
        'marketing-site',
        'experience-site',
        'mobile-native',
        'content-media',
      ].includes(archetype);

      expect(() =>
        resolveFoundryPlan(
          {
            version: 1,
            project: {
              name: `Representative ${archetype}`,
              outcome: 'Prove the archetype can resolve without a capability-owner gap.',
              primaryAudience: 'Representative users',
            },
            archetype,
            access: isKnowledge ? 'none' : isPublicUi ? 'public' : 'none',
            dataSensitivity: 'none',
            commercialModel: 'internal',
            aiRole: 'none',
            deliverables: isKnowledge ? ['document.report'] : [],
          },
          catalog,
        ),
      ).not.toThrow();
    }
  });

  it('keeps catalog pack and style references internally consistent', () => {
    for (const archetype of Object.values(catalog.archetypes)) {
      for (const pack of archetype.packs) expect(catalog.packs[pack]).toBeDefined();
    }
    for (const profile of Object.values(catalog.deliverableProfiles)) {
      expect(catalog.stylePresets[profile.defaultStyle]).toBeDefined();
    }
  });

  it('keeps enterprise identity extensions available without forcing them into simple auth', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Simple Account App',
          outcome: 'Let an individual save private notes.',
          primaryAudience: 'Individual users',
        },
        archetype: 'webapp',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'none',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.modules).toContain('auth');
    expect(plan.modules).toContain('sessions');
    expect(plan.modules).not.toContain('sso');
    expect(plan.modules).not.toContain('mfa');
    expect(plan.modules).not.toContain('passkeys');
    expect(plan.availableModules).toEqual(expect.arrayContaining(['sso', 'mfa', 'passkeys']));
  });

  it('selects only the billing modules implied by a subscription model', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Subscription App',
          outcome: 'Sell recurring access to a software product.',
          primaryAudience: 'Business customers',
        },
        archetype: 'webapp',
        businessModel: 'b2b-saas',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'subscription',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.modules).toEqual(
      expect.arrayContaining([
        'pricing',
        'plans',
        'subscriptions',
        'entitlements',
        'invoices',
        'customer-portal',
        'cancellation',
        'dunning',
      ]),
    );
    expect(plan.modules).not.toContain('coupons');
    expect(plan.availableModules).toContain('coupons');
    expect(plan.packs).toContain('legal');
    expect(plan.artifacts).toContain('document.terms');
  });

  it('allows a specific optional module to become required without forcing sibling modules', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Enterprise Login',
          outcome: 'Let enterprise users sign in through their company identity provider.',
          primaryAudience: 'Enterprise employees',
        },
        archetype: 'webapp',
        businessModel: 'enterprise',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'subscription',
        aiRole: 'none',
        capabilities: { requiredModules: ['sso'] },
      },
      catalog,
    );

    expect(plan.modules).toContain('sso');
    expect(plan.modules).not.toContain('passkeys');
  });

  it('does not let a project exclude a module made required by project facts', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Weak Subscription',
            outcome: 'Sell recurring app access.',
            primaryAudience: 'Customers',
          },
          archetype: 'webapp',
          access: 'authenticated',
          dataSensitivity: 'standard',
          commercialModel: 'subscription',
          aiRole: 'none',
          capabilities: { excludedModules: ['subscriptions'] },
        },
        catalog,
      ),
    ).toThrow(/cannot exclude required Foundry module 'subscriptions'/);
  });

  it('resolves the existing Major install profile and relevant features', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Secure SaaS',
          outcome: 'Provide a secure B2B application.',
          primaryAudience: 'Business teams',
        },
        archetype: 'webapp',
        businessModel: 'b2b-saas',
        access: 'authenticated',
        dataSensitivity: 'personal',
        commercialModel: 'subscription',
        aiRole: 'none',
        jurisdictions: ['uk'],
        deployment: { target: 'vercel' },
      },
      catalog,
    );

    expect(plan.majorProfile).toBe('web-ui');
    expect(plan.majorFeatures).toEqual(expect.arrayContaining(['security', 'vercel']));
  });

  it('does not let a secondary deliverable override a product archetype style', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'App With Sales Deck',
          outcome: 'Sell and operate a B2B software product.',
          primaryAudience: 'Business teams',
        },
        archetype: 'webapp',
        businessModel: 'b2b-saas',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'subscription',
        aiRole: 'none',
        deliverables: ['deck.sales'],
      },
      catalog,
    );

    expect(plan.stylePreset).toBe('minimal-system');
    expect(plan.deliverableGuidance['deck.sales']?.defaultStyle).toBe('consulting-executive');
  });

  it('merges explicit style axes over the selected preset', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Editorial Pitch',
          outcome: 'Raise a seed round.',
          primaryAudience: 'Seed investors',
        },
        archetype: 'knowledge-work',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'none',
        deliverables: ['deck.investor-pitch'],
        style: { density: 'dense', motion: 'none' },
      },
      catalog,
    );

    expect(plan.stylePreset).toBe('bold-startup');
    expect(plan.styleProfile.density).toBe('dense');
    expect(plan.styleProfile.motion).toBe('none');
    expect(plan.styleProfile.voice).toBe('persuasive');
  });

  it('rejects an unknown typed deliverable instead of silently dropping guidance', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Typo Deck',
            outcome: 'Pitch investors.',
            primaryAudience: 'Investors',
          },
          archetype: 'knowledge-work',
          access: 'none',
          dataSensitivity: 'none',
          commercialModel: 'none',
          deliverables: ['deck.investor-picth'],
        },
        catalog,
      ),
    ).toThrow(/unknown Foundry deliverable/);
  });

  it('treats explicit unknown access and commercial model as unresolved', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Unknown Product',
          outcome: 'Deliver a useful product.',
          primaryAudience: 'Users',
        },
        archetype: 'webapp',
        access: 'unknown',
        dataSensitivity: 'standard',
        commercialModel: 'unknown',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.questions.map((item) => item.id)).toEqual(
      expect.arrayContaining(['access', 'commercial-model']),
    );
  });

  it('asks backend access before lower-priority commercial detail when underspecified', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'New API',
          outcome: 'Expose a reliable service.',
          primaryAudience: 'Developers',
        },
        archetype: 'backend-service',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.questions.map((item) => item.id)).toEqual([
      'access',
      'data-sensitivity',
      'commercial-model',
    ]);
    expect(plan.firstQuestionBatch.map((item) => item.id)).toEqual([
      'access',
      'data-sensitivity',
      'commercial-model',
    ]);
  });

  it('rejects unknown manifest keys instead of silently weakening defaults', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Typo Risk',
            outcome: 'Handle regulated records.',
            primaryAudience: 'Operators',
          },
          archetype: 'backend-service',
          access: 'authenticated',
          dataSensitivity: 'personal',
          commercialModel: 'internal',
          aiRole: 'none',
          risk: {
            regulated: false,
            payments: false,
            irreversibleWrites: false,
            regulatted: true,
          },
        },
        catalog,
      ),
    ).toThrow();
  });

  it('requires the autonomy decision for an underspecified automation agent', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Ops Agent',
          outcome: 'Automate a recurring operations workflow.',
          primaryAudience: 'Operations team',
        },
        archetype: 'automation-agent',
        access: 'none',
        dataSensitivity: 'none',
        commercialModel: 'internal',
      },
      catalog,
    );

    expect(plan.firstQuestionBatch.map((item) => item.id)).toContain('ai-autonomy');
  });

  it('requires jurisdiction when legal obligations are activated', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Subscription Product',
          outcome: 'Sell recurring access to a software product.',
          primaryAudience: 'Business customers',
        },
        archetype: 'webapp',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'subscription',
        aiRole: 'none',
      },
      catalog,
    );

    expect(plan.packs).toContain('legal');
    expect(plan.firstQuestionBatch.map((item) => item.id)).toContain('jurisdictions');
  });

  it('treats payment-bearing projects as legal as well as commercial and security work', () => {
    const plan = resolveFoundryPlan(
      {
        version: 1,
        project: {
          name: 'Payment Workflow',
          outcome: 'Collect and reconcile customer payments.',
          primaryAudience: 'Customers',
        },
        archetype: 'webapp',
        access: 'authenticated',
        dataSensitivity: 'standard',
        commercialModel: 'internal',
        aiRole: 'none',
        risk: { payments: true },
      },
      catalog,
    );

    expect(plan.packs).toEqual(expect.arrayContaining(['commercial', 'legal', 'security']));
    expect(plan.questions.map((item) => item.id)).toContain('jurisdictions');
  });

  it('rejects unknown top-level manifest keys instead of silently stripping them', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: { name: 'Strict Manifest' },
          jurisdictioons: ['uk'],
        },
        catalog,
      ),
    ).toThrow(/unrecognized/i);
  });

  it('rejects unknown nested manifest keys instead of silently stripping them', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: { name: 'Strict Nested Manifest', audence: 'Users' },
        },
        catalog,
      ),
    ).toThrow(/unrecognized/i);
  });

  it('rejects whitespace-only required text fields', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: { name: '   ' },
        },
        catalog,
      ),
    ).toThrow();
  });

  it('does not let a project weaken its archetype baseline', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Unsafe Site',
            outcome: 'Publish a site.',
            primaryAudience: 'Public',
          },
          archetype: 'marketing-site',
          access: 'public',
          dataSensitivity: 'standard',
          commercialModel: 'none',
          capabilities: { excluded: ['accessibility'] },
        },
        catalog,
      ),
    ).toThrow(/cannot exclude required Foundry pack 'accessibility'/);
  });

  it('does not let a project exclude a pack required by project facts', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Unsafe Personal Data App',
            outcome: 'Store customer identity data.',
            primaryAudience: 'Customers',
          },
          archetype: 'webapp',
          access: 'authenticated',
          dataSensitivity: 'personal',
          commercialModel: 'none',
          aiRole: 'none',
          jurisdictions: ['uk'],
          capabilities: { excluded: ['privacy'] },
        },
        catalog,
      ),
    ).toThrow(/cannot exclude required Foundry pack 'privacy'/);
  });

  it('rejects unknown excluded packs instead of silently ignoring typos', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Typo Exclusion',
            outcome: 'Publish a site.',
            primaryAudience: 'Public',
          },
          archetype: 'marketing-site',
          access: 'public',
          dataSensitivity: 'standard',
          commercialModel: 'none',
          aiRole: 'none',
          capabilities: { excluded: ['prvacy'] },
        },
        catalog,
      ),
    ).toThrow(/unknown excluded Foundry pack: prvacy/);
  });

  it('does not let a required module silently reactivate an excluded pack', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Contradictory Identity Manifest',
            outcome: 'Publish a public site.',
            primaryAudience: 'Public',
          },
          archetype: 'marketing-site',
          access: 'public',
          dataSensitivity: 'standard',
          commercialModel: 'none',
          aiRole: 'none',
          capabilities: {
            excluded: ['identity'],
            requiredModules: ['sso'],
          },
        },
        catalog,
      ),
    ).toThrow(/cannot exclude required Foundry pack 'identity'/);
  });

  it('rejects unknown excluded modules instead of silently ignoring typos', () => {
    expect(() =>
      resolveFoundryPlan(
        {
          version: 1,
          project: {
            name: 'Typo Module Exclusion',
            outcome: 'Publish a site.',
            primaryAudience: 'Public',
          },
          archetype: 'marketing-site',
          access: 'public',
          dataSensitivity: 'standard',
          commercialModel: 'none',
          aiRole: 'none',
          capabilities: { excludedModules: ['not-a-real-module'] },
        },
        catalog,
      ),
    ).toThrow(/unknown Foundry module: not-a-real-module/);
  });
});
