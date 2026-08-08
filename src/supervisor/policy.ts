import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { majorHome } from './state.js';
import type { WorkerHost } from './state.js';

export const PROJECT_CLASSES = ['unknown', 'workshop', 'client', 'knowledge'] as const;
export type ProjectClass = (typeof PROJECT_CLASSES)[number];

export const TRUST_LEVELS = ['observe', 'assist', 'build', 'unattended'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface IndependentGrade {
  provider: WorkerHost;
  result: 'pass' | 'fail';
  evidence: string;
  at: string;
  goalId?: string | undefined;
  kind: 'shadow' | 'execution';
}

export interface ProjectPolicy {
  project: string;
  repoPath: string;
  projectClass: ProjectClass;
  trust: TrustLevel;
  maxWorkers: number;
  maxRunMinutes: number;
  allowBackground: boolean;
  allowExternalWrites: boolean;
  allowCrossProjectMemory: boolean;
  allowPaidSpend: boolean;
  shadowRuns: number;
  shadowPasses: number;
  updatedAt: string;
  lastGrade?: IndependentGrade | undefined;
}

interface PolicyStore {
  version: 1;
  projects: ProjectPolicy[];
}

export function policyPath(): string {
  return process.env.MAJOR_POLICY_PATH
    ? resolve(process.env.MAJOR_POLICY_PATH)
    : join(majorHome(), 'project-policies.json');
}

export function stopPath(): string {
  return process.env.MAJOR_STOP_PATH
    ? resolve(process.env.MAJOR_STOP_PATH)
    : join(majorHome(), 'STOP');
}

function limitsFor(
  trust: TrustLevel,
): Pick<ProjectPolicy, 'maxWorkers' | 'maxRunMinutes' | 'allowBackground'> {
  switch (trust) {
    case 'observe':
      return { maxWorkers: 0, maxRunMinutes: 0, allowBackground: false };
    case 'assist':
      return { maxWorkers: 3, maxRunMinutes: 30, allowBackground: false };
    case 'build':
      return { maxWorkers: 6, maxRunMinutes: 120, allowBackground: false };
    case 'unattended':
      return { maxWorkers: 8, maxRunMinutes: 480, allowBackground: true };
  }
}

function emptyStore(): PolicyStore {
  return { version: 1, projects: [] };
}

function normalizePolicy(policy: ProjectPolicy): ProjectPolicy {
  return {
    ...policy,
    maxRunMinutes: policy.maxRunMinutes ?? limitsFor(policy.trust).maxRunMinutes,
    allowPaidSpend: policy.allowPaidSpend ?? false,
    shadowRuns: policy.shadowRuns ?? 0,
    shadowPasses: policy.shadowPasses ?? 0,
  };
}

function readStore(): PolicyStore {
  const path = policyPath();
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as PolicyStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
    throw new Error(`invalid Major project-policy store: ${path}`);
  }
  parsed.projects = parsed.projects.map(normalizePolicy);
  return parsed;
}

function writeStore(store: PolicyStore): void {
  const path = policyPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export function defaultProjectPolicy(project: string, repoPath: string): ProjectPolicy {
  return {
    project,
    repoPath: resolve(repoPath),
    projectClass: 'unknown',
    trust: 'observe',
    ...limitsFor('observe'),
    allowExternalWrites: false,
    allowCrossProjectMemory: false,
    allowPaidSpend: false,
    shadowRuns: 0,
    shadowPasses: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function getProjectPolicy(project: string, repoPath: string): ProjectPolicy {
  return (
    readStore().projects.find((candidate) => candidate.project === project) ??
    defaultProjectPolicy(project, repoPath)
  );
}

export function configureProjectPolicy(input: {
  project: string;
  repoPath: string;
  projectClass: ProjectClass;
  trust: TrustLevel;
  allowExternalWrites?: boolean;
  allowPaidSpend?: boolean;
}): ProjectPolicy {
  const store = readStore();
  const existing = store.projects.find((candidate) => candidate.project === input.project);

  if (input.trust === 'assist') {
    if (!existing || existing.shadowPasses < 3 || existing.lastGrade?.result !== 'pass') {
      throw new Error(
        `cannot promote ${input.project} to assist: three consecutive independently graded shadow passes are required first`,
      );
    }
  }
  if (input.trust === 'build') {
    if (
      existing?.trust !== 'assist' ||
      existing.lastGrade?.kind !== 'execution' ||
      existing.lastGrade.result !== 'pass'
    ) {
      throw new Error(
        `cannot promote ${input.project} to build: it must first run at assist and pass an independent execution grade`,
      );
    }
  }
  if (input.trust === 'unattended') {
    if (
      existing?.trust !== 'build' ||
      existing.lastGrade?.kind !== 'execution' ||
      existing.lastGrade.result !== 'pass'
    ) {
      throw new Error(
        `cannot promote ${input.project} to unattended: it must first run at build and pass a fresh independent execution grade`,
      );
    }
  }

  const policy: ProjectPolicy = {
    project: input.project,
    repoPath: resolve(input.repoPath),
    projectClass: input.projectClass,
    trust: input.trust,
    ...limitsFor(input.trust),
    allowExternalWrites: input.allowExternalWrites ?? false,
    allowCrossProjectMemory:
      input.projectClass !== 'client' && (input.trust === 'build' || input.trust === 'unattended'),
    allowPaidSpend: input.allowPaidSpend ?? false,
    shadowRuns: existing?.shadowRuns ?? 0,
    shadowPasses: existing?.shadowPasses ?? 0,
    updatedAt: new Date().toISOString(),
    ...(existing?.lastGrade ? { lastGrade: existing.lastGrade } : {}),
  };

  const index = store.projects.findIndex((candidate) => candidate.project === input.project);
  if (index >= 0) store.projects[index] = policy;
  else store.projects.push(policy);
  writeStore(store);
  return policy;
}

function storeGrade(input: {
  project: string;
  repoPath: string;
  provider: WorkerHost;
  result: 'pass' | 'fail';
  evidence: string;
  kind: 'shadow' | 'execution';
  goalId?: string;
}): ProjectPolicy {
  const store = readStore();
  const index = store.projects.findIndex((candidate) => candidate.project === input.project);
  const current =
    index >= 0 ? store.projects[index]! : defaultProjectPolicy(input.project, input.repoPath);
  const grade: IndependentGrade = {
    provider: input.provider,
    result: input.result,
    evidence: input.evidence,
    at: new Date().toISOString(),
    kind: input.kind,
    ...(input.goalId ? { goalId: input.goalId } : {}),
  };
  const next: ProjectPolicy = {
    ...current,
    repoPath: resolve(input.repoPath),
    lastGrade: grade,
    updatedAt: new Date().toISOString(),
  };
  if (input.kind === 'shadow') {
    next.shadowRuns = current.shadowRuns + 1;
    next.shadowPasses = input.result === 'pass' ? current.shadowPasses + 1 : 0;
  }
  if (index >= 0) store.projects[index] = next;
  else store.projects.push(next);
  writeStore(store);
  return next;
}

export function recordShadowGrade(input: {
  project: string;
  repoPath: string;
  planner: WorkerHost;
  provider: WorkerHost;
  result: 'pass' | 'fail';
  evidence: string;
  goalId?: string;
}): ProjectPolicy {
  if (input.planner === input.provider) {
    throw new Error(
      `shadow grade must be independent: planner and grader are both ${input.provider}`,
    );
  }
  return storeGrade({ ...input, kind: 'shadow' });
}

export function recordIndependentGrade(input: {
  project: string;
  repoPath: string;
  provider: WorkerHost;
  result: 'pass' | 'fail';
  evidence: string;
  goalId?: string;
}): ProjectPolicy {
  return storeGrade({ ...input, kind: 'execution' });
}

export function requestGlobalStop(reason = 'manual kill switch'): void {
  const path = stopPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${new Date().toISOString()} ${reason}\n`, { mode: 0o600 });
}

export function clearGlobalStop(): void {
  const path = stopPath();
  if (existsSync(path)) unlinkSync(path);
}

export function globalStopRequested(): boolean {
  return existsSync(stopPath());
}

export function assertExecutionAllowed(policy: ProjectPolicy): void {
  if (globalStopRequested()) {
    throw new Error(`Major global kill switch is active: ${stopPath()}`);
  }
  if (policy.trust === 'observe' || policy.maxWorkers < 1) {
    throw new Error(
      `project ${policy.project} is ${policy.projectClass}/${policy.trust}: execution is disabled until explicitly promoted`,
    );
  }
}
