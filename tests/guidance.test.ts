import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeEntries,
  guidanceRegistrySchema,
  loadGuidanceRegistry,
  resolveCurrent,
} from '../src/guidance/registry.js';

const registry = guidanceRegistrySchema.parse({
  version: 1,
  entries: [
    { id: 'v1', title: 'Old rules', path: 'a.md', status: 'superseded', supersededBy: 'v2' },
    { id: 'v2', title: 'New rules', path: 'b.md', status: 'active' },
    { id: 'dead', title: 'Retired', path: 'c.md', status: 'deprecated' },
  ],
});

describe('guidance registries', () => {
  it('exposes only active entries as binding', () => {
    expect(activeEntries(registry).map((e) => e.id)).toEqual(['v2']);
  });

  it('follows supersession chains to the current entry', () => {
    expect(resolveCurrent(registry, 'v1')?.id).toBe('v2');
    expect(resolveCurrent(registry, 'dead')).toBeUndefined();
  });

  it('refuses superseded entries without a successor', () => {
    expect(() =>
      guidanceRegistrySchema.parse({
        version: 1,
        entries: [{ id: 'x', title: 'X', path: 'x.md', status: 'superseded' }],
      }),
    ).toThrow(/successor/);
  });

  it('refuses supersession cycles', () => {
    const cyclic = guidanceRegistrySchema.parse({
      version: 1,
      entries: [
        { id: 'a', title: 'A', path: 'a.md', status: 'superseded', supersededBy: 'b' },
        { id: 'b', title: 'B', path: 'b.md', status: 'superseded', supersededBy: 'a' },
      ],
    });
    expect(resolveCurrent(cyclic, 'a')).toBeUndefined();
  });

  it('loads the committed instruction registry', () => {
    const committed = loadGuidanceRegistry('guidance/instructions.registry.json');
    expect(activeEntries(committed).length).toBeGreaterThan(0);
  });

  it('documents execution-independent review without a provider-name gate', () => {
    const readiness = readFileSync('guidance/readiness-and-independent-validation.md', 'utf8');
    const pilot = readFileSync('docs/pilot-deployment.md', 'utf8');
    expect(readiness).toContain('canonical execution distinct from the substantive');
    expect(readiness).toContain('provider diversity is useful corroboration');
    expect(readiness).not.toContain('grader must not be the provider');
    expect(pilot).toContain('--review-receipt-id <major-owned-review-receipt-id>');
    expect(pilot).toContain('same-provider grade is accepted');
    expect(pilot).not.toContain('refuses the grade when the provider matches');
  });
  it('routes curated Knowledge Library context without raw ContextBolt fallback', () => {
    const guide = readFileSync('guidance/tool-routing-and-source-ingestion.md', 'utf8');
    const core = readFileSync('templates/project/major-core.md', 'utf8');
    expect(guide).toContain('authoritative source for distilled cross-topic knowledge');
    expect(guide).toContain('Notion');
    expect(guide).toContain('ContextBolt');
    expect(guide).toContain('GBrain');
    expect(guide).toContain('Eagle');
    expect(guide).toContain('Runtime access check');
    expect(guide).toContain('ContextBolt is excluded from automatic retrieval');
    expect(guide).toContain('explicit ingestion and triage tool only');
    expect(guide).toContain('never silent ContextBolt substitution');
    expect(guide).toContain('the Notion Knowledge Bank');
    expect(guide).toContain('current project decision outranks an older global Notion note');
    expect(guide).toContain(
      'updating Notion, GBrain or any maintained knowledge record requires explicit owner authorization',
    );
    expect(guide).toContain('Do not put full private library content into logs');
    expect(guide).not.toContain('ContextBolt original saves');
    expect(guide).not.toContain('search_bookmarks');
    expect(guide).not.toContain(
      'When examples, source links or conflicting evidence matter, use the installed',
    );
    expect(core).toContain('Do not automatically retrieve ContextBolt');
    expect(core).toContain('If Notion is unavailable or no maintained Knowledge Piece');
    expect(core).toContain('Never substitute untriaged saves');
    expect(core).toContain('Knowledge Library lookup when relevant');

    const audit = readFileSync('docs/skill-activation-knowledge-library-audit.md', 'utf8');
    expect(audit).toContain('not fully triaged');
    expect(audit).toContain(
      'Only **Notion** is required for automatic curated-knowledge retrieval',
    );
    expect(audit).toContain('ContextBolt: optional for explicit triage only');
    expect(audit).not.toContain('codex mcp login contextbolt-bookmarks');
  });
});
