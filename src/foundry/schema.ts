import { z } from 'zod';

export const foundryArchetypes = [
  'webapp',
  'marketing-site',
  'experience-site',
  'mobile-native',
  'backend-service',
  'automation-agent',
  'data-product',
  'library-cli-sdk',
  'content-media',
  'knowledge-work',
] as const;

export const foundryArchetypeSchema = z.enum(foundryArchetypes);
export type FoundryArchetype = z.infer<typeof foundryArchetypeSchema>;

const nonBlank = z.string().trim().min(1);

export const foundryManifestSchema = z
  .object({
    version: z.literal(1).default(1),
    project: z
      .object({
        name: nonBlank,
        outcome: nonBlank.optional(),
        primaryAudience: nonBlank.optional(),
      })
      .strict(),
    archetype: foundryArchetypeSchema.optional(),
    businessModel: nonBlank.optional(),
    access: z.enum(['public', 'authenticated', 'mixed', 'none', 'unknown']).optional(),
    dataSensitivity: z
      .enum(['none', 'standard', 'personal', 'special-category', 'financial', 'unknown'])
      .optional(),
    commercialModel: z
      .enum([
        'none',
        'internal',
        'services',
        'subscription',
        'usage',
        'transaction',
        'marketplace',
        'commerce',
        'advertising',
        'sponsorship',
        'unknown',
      ])
      .optional(),
    aiRole: z.enum(['none', 'assistive', 'decision-support', 'autonomous', 'unknown']).optional(),
    jurisdictions: z.array(nonBlank).default([]),
    domains: z.array(nonBlank).default([]),
    risk: z
      .object({
        regulated: z.boolean().default(false),
        payments: z.boolean().default(false),
        irreversibleWrites: z.boolean().default(false),
      })
      .strict()
      .default({ regulated: false, payments: false, irreversibleWrites: false }),
    capabilities: z
      .object({
        required: z.array(nonBlank).default([]),
        optional: z.array(nonBlank).default([]),
        excluded: z.array(nonBlank).default([]),
        requiredModules: z.array(nonBlank).default([]),
        excludedModules: z.array(nonBlank).default([]),
      })
      .strict()
      .default({
        required: [],
        optional: [],
        excluded: [],
        requiredModules: [],
        excludedModules: [],
      }),
    deliverables: z.array(nonBlank).default([]),
    style: z
      .object({
        preset: nonBlank.optional(),
        density: z.enum(['sparse', 'balanced', 'dense']).optional(),
        language: z
          .enum([
            'minimal',
            'editorial',
            'consulting',
            'cinematic',
            'luxury',
            'institutional',
            'technical',
            'playful',
            'experimental',
            'brutalist',
          ])
          .optional(),
        layout: z
          .enum(['strict-grid', 'modular', 'asymmetric', 'full-bleed', 'card-based', 'data-led'])
          .optional(),
        imagery: z
          .enum([
            'none',
            'product-ui',
            'photography',
            'illustration',
            'diagram',
            '3d',
            'generative',
            'mixed-media',
          ])
          .optional(),
        motion: z.enum(['none', 'functional', 'subtle', 'expressive', 'immersive']).optional(),
        colour: z
          .enum(['monochrome', 'neutral-accent', 'restrained', 'brand-heavy', 'vibrant', 'dark'])
          .optional(),
        voice: z
          .enum([
            'plainspoken',
            'analytical',
            'executive',
            'persuasive',
            'academic',
            'provocative',
            'warm',
          ])
          .optional(),
      })
      .strict()
      .default({}),
    deployment: z
      .object({
        target: nonBlank.optional(),
      })
      .strict()
      .default({}),
    assumptions: z.array(nonBlank).default([]),
  })
  .strict();

export type FoundryManifest = z.infer<typeof foundryManifestSchema>;

export const foundryCatalogSchema = z
  .object({
    version: z.number().int().positive(),
    operatingCore: z.array(nonBlank),
    archetypes: z.record(
      foundryArchetypeSchema,
      z
        .object({
          packs: z.array(nonBlank),
          defaultDeliverables: z.array(nonBlank),
          majorProfile: z.enum(['core', 'knowledge', 'web-ui', 'exploratory', 'full']),
          majorFeatures: z.array(nonBlank),
        })
        .strict(),
    ),
    packs: z.record(
      nonBlank,
      z
        .object({
          baselineModules: z.array(nonBlank),
          availableModules: z.array(nonBlank),
          baselineArtifacts: z.array(nonBlank),
          availableArtifacts: z.array(nonBlank),
        })
        .strict(),
    ),
    jurisdictions: z.array(nonBlank),
    deliverableProfiles: z.record(
      z.string(),
      z
        .object({
          purpose: nonBlank,
          sections: z.array(nonBlank),
          qualityChecks: z.array(nonBlank),
          defaultStyle: nonBlank,
        })
        .strict(),
    ),
    stylePresets: z.record(z.string(), z.record(z.string(), z.string())),
  })
  .strict();

export type FoundryCatalog = z.infer<typeof foundryCatalogSchema>;
