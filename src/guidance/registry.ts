import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Machine-readable registries for instructions and skills. Entries are never
 * deleted: deprecated guidance stays listed with status 'deprecated' or
 * 'superseded' (plus a pointer to its successor) so agents can recognise and
 * refuse stale guidance.
 */

export const GUIDANCE_STATUSES = ['active', 'deprecated', 'superseded'] as const;

export const guidanceEntrySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    path: z.string().min(1),
    status: z.enum(GUIDANCE_STATUSES).default('active'),
    /** Required when status is 'superseded': the id of the successor entry. */
    supersededBy: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((e) => e.status !== 'superseded' || Boolean(e.supersededBy), {
    message: 'superseded entries must name their successor in supersededBy',
  });

export const guidanceRegistrySchema = z.object({
  version: z.literal(1),
  entries: z.array(guidanceEntrySchema),
});

export type GuidanceRegistry = z.infer<typeof guidanceRegistrySchema>;
export type GuidanceEntry = z.infer<typeof guidanceEntrySchema>;

export function loadGuidanceRegistry(path: string): GuidanceRegistry {
  return guidanceRegistrySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function activeEntries(registry: GuidanceRegistry): GuidanceEntry[] {
  return registry.entries.filter((e) => e.status === 'active');
}

/** Follow supersededBy pointers from any entry to the current active one. */
export function resolveCurrent(
  registry: GuidanceRegistry,
  id: string,
  seen = new Set<string>(),
): GuidanceEntry | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  const entry = registry.entries.find((e) => e.id === id);
  if (!entry) return undefined;
  if (entry.status === 'superseded' && entry.supersededBy) {
    return resolveCurrent(registry, entry.supersededBy, seen);
  }
  return entry.status === 'active' ? entry : undefined;
}
