import { resolve, sep } from 'node:path';

export const CANONICAL_SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertCanonicalSkillSlug(value: string, label = 'skill id'): void {
  if (!CANONICAL_SKILL_SLUG.test(value)) {
    throw new Error(`${label} must be a safe canonical slug: ${JSON.stringify(value)}`);
  }
}

export function containedSkillPath(root: string, slug: string, filename: string): string {
  assertCanonicalSkillSlug(slug);
  const canonicalRoot = resolve(root);
  const target = resolve(canonicalRoot, slug, filename);
  if (!target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`generated skill path escapes its root: ${JSON.stringify(slug)}`);
  }
  return target;
}

export function containedGeneratedCommandPath(root: string, slug: string, suffix: string): string {
  assertCanonicalSkillSlug(slug);
  if (!/^\.[a-z]+$/.test(suffix)) throw new Error(`invalid generated command suffix: ${suffix}`);
  const canonicalRoot = resolve(root);
  const target = resolve(canonicalRoot, `${slug}${suffix}`);
  if (!target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`generated command path escapes its root: ${JSON.stringify(slug)}`);
  }
  return target;
}
