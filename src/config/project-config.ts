import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Generic project adapter configuration. Everything machine- or
 * account-specific is expressed as a path relative to home ('~/...'),
 * an environment-variable name, or omitted — never a hard-coded credential.
 */

export const roadmapSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('google-sheets'),
    spreadsheetId: z.string().min(1),
    sheetName: z.string().min(1),
    /** Column holding the stable roadmap row ID. */
    stableIdColumn: z.string().min(1),
    /** Name of the env var pointing at a service-account credentials file. */
    credentialsEnvVar: z.string().min(1).default('GOOGLE_APPLICATION_CREDENTIALS'),
  }),
  z.object({ type: z.literal('file'), path: z.string().min(1) }),
  z.object({ type: z.literal('none') }),
]);

export const projectConfigSchema = z.object({
  name: z.string().min(1),
  /** Repository path; '~' expands to the current user's home directory. */
  repoPath: z.string().min(1),
  githubRepo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'expected owner/repo')
    .optional(),
  roadmapSource: roadmapSourceSchema.default({ type: 'none' }),
  /** Registry locations, relative to the repo unless absolute. */
  instructionRegistryPath: z.string().default('guidance/instructions.registry.json'),
  skillsRegistryPath: z.string().default('guidance/skills.registry.json'),
  /** Commands run to verify a change (tests, lint, typecheck...). */
  verificationCommands: z.array(z.string()).default([]),
  /**
   * Executables the execution gateway may spawn for this project. Mandatory
   * allowlist semantics: anything not listed is refused at spawn time.
   */
  allowedExecutables: z
    .array(z.string().min(1))
    .nonempty()
    .default(['claude', 'codex', 'git', 'pnpm', 'node', 'which']),
  /** Paths agents must never modify, relative to the repo. */
  protectedPaths: z.array(z.string()).default([]),
  /** Additional prohibited command patterns (regex sources). */
  prohibitedCommands: z.array(z.string()).default([]),
  /** Branches that never receive direct pushes. */
  protectedBranches: z.array(z.string()).default(['main']),
  /** Decision categories that always require human approval. */
  approvalCategories: z
    .array(z.string())
    .default(['paid_usage', 'merge', 'deploy', 'roadmap_done', 'security_exception']),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function resolveRepoPath(config: ProjectConfig): string {
  return resolve(expandHome(config.repoPath));
}

export function resolveInRepo(config: ProjectConfig, path: string): string {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : join(resolveRepoPath(config), expanded);
}

export function loadProjectConfig(path: string): ProjectConfig {
  const raw = readFileSync(expandHome(path), 'utf8');
  return projectConfigSchema.parse(JSON.parse(raw));
}
