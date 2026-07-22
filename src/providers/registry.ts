import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BILLING_MODES,
  MODEL_AVAILABILITIES,
  ROUTING_CLASSES,
  type BillingMode,
  type RoutingClass,
} from '../db/schema.js';
import type { ModelState } from './types.js';

/**
 * Configurable capability registry. Model names are DATA, not code: routing
 * classes are assigned by user-editable matching rules so new model names
 * never require a code change. Overrides load from ~/.major/model-registry.json
 * (or $MAJOR_MODEL_REGISTRY).
 */

const modelRuleSchema = z.object({
  provider: z.string(),
  /** Regex matched against the provider-reported model ref/alias. */
  match: z.string(),
  routingClass: z.enum(ROUTING_CLASSES),
  billingMode: z.enum(BILLING_MODES).default('unknown'),
  prohibited: z.boolean().default(false),
  prohibitedReason: z.string().optional(),
});

const registryEntrySchema = z.object({
  provider: z.string(),
  /** Model refs/aliases expected to exist for this provider. */
  knownModels: z.array(z.string()).default([]),
  rules: z.array(modelRuleSchema.omit({ provider: true })).default([]),
});

export const modelRegistrySchema = z.object({
  version: z.literal(1),
  entries: z.array(registryEntrySchema),
});

export type ModelRegistry = z.infer<typeof modelRegistrySchema>;
export type ModelRule = z.infer<typeof modelRuleSchema>;

/**
 * Default registry. Class-level aliases ('opus', 'sonnet') are preferred over
 * versioned marketing names so the registry survives model releases; users
 * override this file as providers evolve.
 */
export const DEFAULT_MODEL_REGISTRY: ModelRegistry = {
  version: 1,
  entries: [
    {
      provider: 'claude-code',
      knownModels: ['fable', 'opus', 'sonnet', 'haiku'],
      rules: [
        {
          match: 'fable|mythos',
          routingClass: 'fable',
          billingMode: 'subscription_included',
          prohibited: false,
        },
        {
          match: 'opus',
          routingClass: 'opus',
          billingMode: 'subscription_included',
          prohibited: false,
        },
        {
          match: 'sonnet',
          routingClass: 'sonnet',
          billingMode: 'subscription_included',
          prohibited: false,
        },
        {
          match: 'haiku',
          routingClass: 'sonnet',
          billingMode: 'subscription_included',
          prohibited: false,
        },
      ],
    },
    {
      provider: 'codex',
      knownModels: ['gpt-5.3-codex'],
      rules: [
        {
          match: '.*',
          routingClass: 'codex',
          billingMode: 'subscription_included',
          prohibited: false,
        },
      ],
    },
  ],
};

export function defaultRegistryPath(): string {
  return process.env.MAJOR_MODEL_REGISTRY ?? join(homedir(), '.major', 'model-registry.json');
}

export function loadModelRegistry(path: string = defaultRegistryPath()): ModelRegistry {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return DEFAULT_MODEL_REGISTRY;
  }
  return modelRegistrySchema.parse(JSON.parse(raw));
}

export interface Classification {
  routingClass: RoutingClass;
  billingMode: BillingMode;
  prohibited: boolean;
  prohibitedReason?: string;
}

export function classifyModel(
  registry: ModelRegistry,
  provider: string,
  modelRef: string,
): Classification {
  const entry = registry.entries.find((e) => e.provider === provider);
  for (const rule of entry?.rules ?? []) {
    if (new RegExp(rule.match, 'i').test(modelRef)) {
      const result: Classification = {
        routingClass: rule.routingClass,
        billingMode: rule.billingMode,
        prohibited: rule.prohibited,
      };
      if (rule.prohibitedReason !== undefined) result.prohibitedReason = rule.prohibitedReason;
      return result;
    }
  }
  return { routingClass: 'unknown', billingMode: 'unknown', prohibited: false };
}

/** Models the registry expects for a provider, before any live probing. */
export function registryModels(
  registry: ModelRegistry,
  provider: string,
  base: { visible: boolean; authenticated: boolean },
): ModelState[] {
  const entry = registry.entries.find((e) => e.provider === provider);
  return (entry?.knownModels ?? []).map((modelRef) => {
    const cls = classifyModel(registry, provider, modelRef);
    const state: ModelState = {
      modelRef,
      routingClass: cls.routingClass,
      visible: base.visible,
      authenticated: base.authenticated,
      availability: base.visible && base.authenticated ? 'available' : 'unknown',
      billingMode: cls.billingMode,
      prohibited: cls.prohibited,
      source: 'registry',
    };
    if (cls.prohibitedReason !== undefined) state.prohibitedReason = cls.prohibitedReason;
    return state;
  });
}

/** Availability schema re-exported for consumers validating probe data. */
export const modelAvailabilitySchema = z.enum(MODEL_AVAILABILITIES);
