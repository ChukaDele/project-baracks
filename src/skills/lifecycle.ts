import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { redactText } from '../security/redact.js';
import { getProjectPolicy } from '../supervisor/policy.js';
import { majorHome, resolveProjectForCwd } from '../supervisor/state.js';
import { validateSkillOptimization, type SkillOptimizationEvidence } from './optimizer-validation.js';

export const SKILL_LIFECYCLE_STATUSES = ['candidate', 'active', 'review', 'deprecated'] as const;
export type SkillLifecycleStatus = (typeof SKILL_LIFECYCLE_STATUSES)[number];

export interface WorkflowObservation {
  task: string;
  outcome: string;
  steps: string[];
  tools?: string[];
  validations: string[];
  durationMs?: number;
  cost?: number;
  success: boolean;
  project: string;
  repoPath: string;
  goalId: string;
  resolvedSkillIds: readonly string[];
  scope?: 'project' | 'global';
}

export interface SkillPerformance {
  uses: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  totalCost: number;
  lastUsedAt?: string;
}

export interface SkillCandidate {
  id: string;
  skillId: string;
  project: string;
  scope: 'project' | 'global';
  status: SkillLifecycleStatus;
  version: number;
  description: string;
  trigger: string;
  steps: string[];
  tools: string[];
  validations: string[];
  taskFingerprints: string[];
  taskExamples: string[];
  evidenceHashes: string[];
  goalIds: string[];
  independentValidationHashes: string[];
  approvedSkillHash?: string;
  occurrences: number;
  successes: number;
  meanSimilarity: number;
  confidence: number;
  targetSkillId?: string;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  deprecatedAt?: string;
  restoredAt?: string;
  path?: string;
  skillHash?: string;
  performance: SkillPerformance;
}

interface CandidateStore {
  version: 1;
  candidates: SkillCandidate[];
}

const EMPTY_PERFORMANCE: SkillPerformance = {
  uses: 0,
  successes: 0,
  failures: 0,
  totalDurationMs: 0,
  totalCost: 0,
};

const CONCEPTS: Record<string, string> = {
  collided: 'collision',
  colliding: 'collision',
  conflicts: 'collision',
  ports: 'port',
  servers: 'server',
  namespaces: 'namespace',
  isolated: 'isolate',
  isolation: 'isolate',
  retries: 'retry',
  recurring: 'repeat',
  repeated: 'repeat',
  workflows: 'workflow',
  procedures: 'procedure',
  validating: 'validate',
  validation: 'validate',
  tests: 'test',
  testing: 'test',
  fixes: 'fix',
  fixed: 'fix',
};

const STOP = new Set([
  'about',
  'after',
  'again',
  'also',
  'before',
  'from',
  'have',
  'into',
  'major',
  'project',
  'that',
  'their',
  'then',
  'this',
  'using',
  'with',
]);

function root(): string {
  return process.env.MAJOR_SKILL_LIFECYCLE_ROOT
    ? resolve(process.env.MAJOR_SKILL_LIFECYCLE_ROOT)
    : join(majorHome(), 'skills');
}

function projectKey(project: string): string {
  return createHash('sha256').update(project).digest('hex').slice(0, 24);
}

function candidatePath(project: string): string {
  return join(root(), 'candidates', `${projectKey(project)}.json`);
}

function skillRoot(scope: 'project' | 'global', project: string): string {
  return scope === 'global'
    ? join(root(), 'internal')
    : join(root(), 'projects', projectKey(project));
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function withStoreLock<T>(path: string, action: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  const deadline = Date.now() + 5_000;
  const token = randomUUID();
  const ownerRecord = `${process.pid} ${token}`;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(lock, 'wx', 0o600);
      try {
        writeFileSync(fd, `${ownerRecord}\n`);
      } catch (error) {
        closeSync(fd);
        fd = undefined;
        try {
          if (existsSync(lock) && readFileSync(lock, 'utf8').trim() === ownerRecord) unlinkSync(lock);
        } catch {
          // Preserve the original write failure.
        }
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!existsSync(lock)) continue;
      if (Date.now() >= deadline) throw new Error(`timed out waiting for skill lifecycle lock: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    closeSync(fd);
    try {
      if (existsSync(lock) && readFileSync(lock, 'utf8').trim() === ownerRecord) unlinkSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => CONCEPTS[word] ?? word.replace(/(?:ing|ed|s)$/, ''))
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

function concepts(observation: Pick<WorkflowObservation, 'task' | 'outcome' | 'steps'>): Set<string> {
  return new Set(tokens([observation.task, observation.outcome, ...observation.steps].join(' ')));
}

function similarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / union.size;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function slug(words: string[]): string {
  const value = [...new Set(words)].slice(0, 5).join('-').slice(0, 64).replace(/-+$/g, '');
  return value && /^[a-z0-9]/.test(value) ? value : `learned-${fingerprint(words.join(' ')).slice(0, 12)}`;
}

function confidence(candidate: Pick<SkillCandidate, 'occurrences' | 'successes' | 'meanSimilarity' | 'taskFingerprints' | 'independentValidationHashes'>): number {
  const recurrence = candidate.occurrences >= 2 ? 0.25 : 0;
  const consistency = candidate.meanSimilarity * 0.35;
  const validation = Math.min(candidate.independentValidationHashes.length, 1) * 0.25;
  const diversity = new Set(candidate.taskFingerprints).size >= 2 ? 0.15 : 0;
  return Number((recurrence + consistency + validation + diversity).toFixed(3));
}

function commonSteps(left: string[], right: string[]): string[] {
  if (left.length === 0) return right;
  const rightConcepts = right.map((step) => concepts({ task: '', outcome: '', steps: [step] }));
  const common = left.filter((step) => {
    const source = concepts({ task: '', outcome: '', steps: [step] });
    return rightConcepts.some((candidate) => similarity(source, candidate) >= 0.4);
  });
  return common.length > 0 ? common : left;
}

function sanitized(value: string): string {
  return redactText(value.trim()).slice(0, 2_000);
}

function safeList(values: readonly string[] | undefined, limit = 20): string[] {
  return [...new Set((values ?? []).map(sanitized).filter(Boolean))].slice(0, limit);
}

function actionSignals(steps: readonly string[], tools: readonly string[]): string[] {
  const source = `${steps.join(' ')} ${tools.join(' ')}`.toLowerCase();
  const signals: string[] = [];
  if (/inspect|read|search|research|review|audit/.test(source)) signals.push('inspection');
  if (/edit|change|write|create|reserve|assign|partition|refactor|fix/.test(source))
    signals.push('reversible-change');
  if (/test|verify|validate|probe|check|build|lint/.test(source))
    signals.push('objective-validation');
  if (/retry|recover|revert|rollback|restart/.test(source)) signals.push('bounded-recovery');
  return signals.length > 0 ? signals : ['policy-bounded-work'];
}

function observeSuccessfulWorkflowUnlocked(input: WorkflowObservation): SkillCandidate {
  if (!input.success) throw new Error('only successful workflows are eligible for skillification');
  if (!input.task.trim() || !input.outcome.trim() || input.steps.length === 0) {
    throw new Error('workflow observation requires task, outcome and at least one step');
  }
  if (!input.goalId.trim()) throw new Error('workflow observation requires a durable goal identity');
  const policy = getProjectPolicy(input.project, input.repoPath);
  const scope = input.scope ?? 'project';
  if (scope === 'global') {
    throw new Error(
      `automatic global skillification is forbidden; promote sanitized project evidence through the existing learning review (${policy.project})`,
    );
  }
  const path = candidatePath(input.project);
  const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
  const observationConcepts = concepts(input);
  let match: { candidate: SkillCandidate; score: number } | undefined;
  for (const candidate of store.candidates.filter((item) => item.status !== 'deprecated')) {
    const score = Math.max(
      ...candidate.taskExamples.map((example) =>
        similarity(observationConcepts, concepts({ task: example, outcome: candidate.description, steps: candidate.steps })),
      ),
    );
    if (score >= 0.5 && (!match || score > match.score)) match = { candidate, score };
  }
  const now = new Date().toISOString();
  const task = sanitized(input.task);
  const taskHash = fingerprint(tokens(task).sort().join(' '));
  const evidenceHash = fingerprint(
    JSON.stringify({
      task: tokens(task).sort(),
      outcome: tokens(input.outcome).sort(),
      steps: input.steps.map((step) => tokens(step).sort()),
      validations: safeList(input.validations),
    }),
  );
  if (match) {
    const candidate = match.candidate;
    if (candidate.goalIds.includes(input.goalId)) return candidate;
    if (candidate.status === 'active') {
      candidate.status = 'review';
      candidate.version += 1;
    }
    candidate.occurrences += 1;
    candidate.successes += 1;
    candidate.meanSimilarity = Number(
      (((candidate.meanSimilarity * (candidate.occurrences - 2)) + match.score) / (candidate.occurrences - 1)).toFixed(3),
    );
    candidate.steps = commonSteps(candidate.steps, safeList(input.steps));
    candidate.tools = [...new Set([...candidate.tools, ...safeList(input.tools)])].slice(0, 20);
    candidate.validations = [...new Set([...candidate.validations, ...safeList(input.validations)])].slice(0, 20);
    if (!candidate.taskFingerprints.includes(taskHash)) candidate.taskFingerprints.push(taskHash);
    if (!candidate.taskExamples.includes(task)) candidate.taskExamples.push(task);
    if (!candidate.evidenceHashes.includes(evidenceHash)) candidate.evidenceHashes.push(evidenceHash);
    if (!candidate.goalIds.includes(input.goalId)) candidate.goalIds.push(input.goalId);
    candidate.confidence = confidence(candidate);
    candidate.updatedAt = now;
    atomicWrite(path, store);
    return candidate;
  }

  const signals = actionSignals(input.steps, input.tools ?? []);
  const targetSkillId = input.resolvedSkillIds[0];
  const candidate: SkillCandidate = {
    id: randomUUID(),
    skillId: slug([...signals, taskHash.slice(0, 8)]),
    project: input.project,
    scope,
    status: 'candidate',
    version: 1,
    description: sanitized(input.outcome),
    // Routing evidence remains project-local metadata. It is never copied into
    // the generated instruction file; skillMarkdown emits only fixed classes.
    trigger: [...observationConcepts].slice(0, 12).join(' '),
    steps: safeList(input.steps),
    tools: safeList(input.tools),
    validations: safeList(input.validations),
    taskFingerprints: [taskHash],
    taskExamples: [task],
    evidenceHashes: [evidenceHash],
    goalIds: [input.goalId],
    independentValidationHashes: [],
    occurrences: 1,
    successes: 1,
    meanSimilarity: 1,
    confidence: 0,
    performance: { ...EMPTY_PERFORMANCE },
    createdAt: now,
    updatedAt: now,
    ...(targetSkillId ? { targetSkillId } : {}),
  };
  candidate.confidence = confidence(candidate);
  store.candidates.push(candidate);
  atomicWrite(path, store);
  return candidate;
}

export function observeSuccessfulWorkflow(input: WorkflowObservation): SkillCandidate {
  return withStoreLock(candidatePath(input.project), () => observeSuccessfulWorkflowUnlocked(input));
}

function skillMarkdown(candidate: SkillCandidate): string {
  const metadata = [
    `version: "${candidate.version}"`,
    `status: "active"`,
    `candidate-id: "${candidate.id}"`,
    `evidence-count: "${candidate.evidenceHashes.length}"`,
  ];
  const trigger = actionSignals(candidate.steps, candidate.tools).join(' ');
  const operationBySignal: Record<string, string> = {
    inspection: 'Inspect the current project state and relevant evidence.',
    'reversible-change': 'Apply the smallest reversible change inside the assigned project boundary.',
    'objective-validation': 'Run the objective project checks that demonstrated the procedure.',
    'bounded-recovery': 'If the first attempt fails, preserve evidence and use the proven recovery path.',
    'policy-bounded-work': 'Follow the project evidence and perform only reversible, policy-allowed work.',
  };
  const operations = actionSignals(candidate.steps, candidate.tools).map(
    (signal) => operationBySignal[signal]!,
  );
  const description = `Apply a proven project workflow for ${trigger}. Use when the task matches these signals.`;
  return `---\nname: ${candidate.skillId}\ndescription: ${description}\nmetadata:\n${metadata.map((line) => `  ${line}`).join('\n')}\n---\n\n# ${candidate.skillId}\n\n## Trigger\n\nUse when the task matches these normalized signals: ${trigger}.\n\nDo not use when the task does not match the proven trigger or when project policy forbids the required action.\n\n## Inputs\n\n- The assigned project and task goal.\n- The current project policy and relevant evidence.\n\n## Procedure\n\n${operations.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n## Tools\n\n- Use only tools already available within the assigned project capability boundary.\n\n## Outputs\n\n- A reversible project result supported by objective checks.\n\n## Constraints\n\n- Keep project-local evidence inside the project boundary.\n- Policy owns authority. This skill does not grant permission.\n- Do not access unrelated credentials, projects, production data or external systems.\n- Stop when the procedure no longer matches observed evidence.\n\n## Validation\n\n- Re-run the objective project checks recorded by the originating goals.\n- Treat reviewer or user corrections as failure evidence.\n\n## Provenance\n\n- Candidate: ${candidate.id}\n- Observations: ${candidate.occurrences}\n- Evidence digests: ${candidate.evidenceHashes.join(', ')}\n\n## Performance\n\nMajor records usage and outcomes in the GBrain skill lifecycle.\n\n## Lifecycle\n\n- Version: ${candidate.version}\n- Status: active\n- Created: ${candidate.createdAt}\n`;
}

export function validateGeneratedSkill(input: { skillId: string; markdown: string }): string[] {
  const errors: string[] = [];
  const frontmatter = input.markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) return ['SKILL.md must contain YAML frontmatter'];
  const name = frontmatter[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== input.skillId) errors.push('frontmatter name must match the skill directory');
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    errors.push('skill name must follow the Agent Skills name constraints');
  }
  if (!description || description.length > 1024) {
    errors.push('skill description must be 1-1024 characters');
  }
  if (
    /(?:rm\s+-rf|git\s+reset\s+--hard|production\s+deploy|read\s+(?:all\s+)?(?:credentials|tokens|secrets)|disable\s+(?:major\s+)?policy|bypass\s+(?:approval|policy))/i.test(
      input.markdown,
    )
  ) {
    errors.push('skill instructions contain a forbidden destructive or authority-expanding action');
  }
  for (const section of ['Trigger', 'Inputs', 'Procedure', 'Outputs', 'Constraints', 'Validation', 'Provenance', 'Performance', 'Lifecycle']) {
    if (!input.markdown.includes(`## ${section}`)) errors.push(`missing required section: ${section}`);
  }
  return errors;
}

function promoteSkillCandidateUnlocked(input: { id: string; project: string; repoPath: string; optimizationEvidence?: SkillOptimizationEvidence }): SkillCandidate {
  const path = candidatePath(input.project);
  const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
  const candidate = store.candidates.find((item) => item.id === input.id);
  if (!candidate) throw new Error(`skill candidate not found: ${input.id}`);
  if (candidate.status !== 'candidate' && candidate.status !== 'review') {
    throw new Error(`skill candidate ${input.id} is already ${candidate.status}`);
  }
  if (candidate.targetSkillId && candidate.targetSkillId !== candidate.skillId) {
    candidate.status = 'review';
    candidate.updatedAt = new Date().toISOString();
    atomicWrite(path, store);
    throw new Error(`candidate overlaps existing skill ${candidate.targetSkillId}; update it instead of creating a duplicate`);
  }
  if (candidate.occurrences < 2 || candidate.taskFingerprints.length < 2 || candidate.confidence < 0.8) {
    throw new Error(`skill candidate lacks consistent recurring evidence: confidence ${candidate.confidence}`);
  }
  const optimization = input.optimizationEvidence
    ? validateSkillOptimization(input.optimizationEvidence)
    : { status: 'rejected' as const, reasons: ['optimizer-evidence-required'] };
  if (optimization.status !== 'promotable') {
    throw new Error(`skill optimization evidence is not promotable: ${optimization.reasons.join(', ')}`);
  }
  if (candidate.scope === 'global') throw new Error('automatic global skill promotion is forbidden');
  const markdown = skillMarkdown(candidate);
  if (!candidate.approvedSkillHash || fingerprint(markdown) !== candidate.approvedSkillHash) {
    throw new Error('generated skill content is not bound to its independent validation');
  }
  const errors = validateGeneratedSkill({ skillId: candidate.skillId, markdown });
  if (errors.length) throw new Error(`generated skill validation failed: ${errors.join('; ')}`);
  const priorVersion = candidate.path ? candidate.version - 1 : undefined;
  const destination = join(skillRoot(candidate.scope, candidate.project), candidate.skillId, 'SKILL.md');
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  if (existsSync(destination)) {
    const archive = join(dirname(destination), `SKILL.v${priorVersion ?? candidate.version}.md`);
    writeFileSync(archive, readFileSync(destination), { mode: 0o600 });
  }
  const content = skillMarkdown(candidate);
  writeFileSync(destination, content, { mode: 0o600 });
  const now = new Date().toISOString();
  candidate.status = 'active';
  candidate.path = destination;
  candidate.skillHash = fingerprint(content);
  candidate.promotedAt = now;
  candidate.updatedAt = now;
  atomicWrite(path, store);
  return candidate;
}

export function promoteSkillCandidate(input: { id: string; project: string; repoPath: string; optimizationEvidence?: SkillOptimizationEvidence }): SkillCandidate {
  return withStoreLock(candidatePath(input.project), () => promoteSkillCandidateUnlocked(input));
}

function validateSkillCandidatesForGoal(input: {
  project: string;
  repoPath: string;
  goalId: string;
  provider: string;
  evidence: string;
}): SkillCandidate[] {
  const grade = getProjectPolicy(input.project, input.repoPath).lastGrade;
  const evidence = redactText(input.evidence.trim());
  if (
    !grade ||
    grade.kind !== 'execution' ||
    grade.result !== 'pass' ||
    grade.goalId !== input.goalId ||
    grade.provider !== input.provider ||
    grade.evidence !== evidence
  ) {
    throw new Error('skill validation requires the matching stored independent execution grade');
  }
  const path = candidatePath(input.project);
  return withStoreLock(path, () => {
    const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
    const eligible = store.candidates.filter(
      (candidate) =>
        (candidate.status === 'candidate' || candidate.status === 'review') &&
        candidate.goalIds.includes(input.goalId),
    );
    for (const candidate of eligible) {
      const contentHash = fingerprint(skillMarkdown(candidate));
      const digest = fingerprint(
        `${candidate.id}\n${contentHash}\n${input.provider}\n${evidence}`,
      );
      if (!candidate.independentValidationHashes.includes(digest)) {
        candidate.independentValidationHashes.push(digest);
      }
      candidate.confidence = confidence(candidate);
      candidate.approvedSkillHash = contentHash;
      candidate.updatedAt = new Date().toISOString();
    }
    if (eligible.length > 0) atomicWrite(path, store);
    return eligible;
  });
}

export function applyIndependentSkillValidation(input: {
  project: string;
  repoPath: string;
  goalId: string;
  provider: string;
  evidence: string;
  optimizationEvidence?: SkillOptimizationEvidence;
}): { validated: SkillCandidate[]; promoted: SkillCandidate[] } {
  const validated = validateSkillCandidatesForGoal(input);
  const promoted: SkillCandidate[] = [];
  for (const candidate of validated) {
    if (
      candidate.occurrences < 2 ||
      candidate.taskFingerprints.length < 2 ||
      candidate.confidence < 0.8
    ) {
      continue;
    }
    try {
      promoted.push(
        promoteSkillCandidate({
          id: candidate.id,
          project: input.project,
          repoPath: input.repoPath,
          ...(input.optimizationEvidence
            ? { optimizationEvidence: input.optimizationEvidence }
            : {}),
        }),
      );
    } catch {
      // Overlap and validation failures remain visible for review.
    }
  }
  return { validated, promoted };
}

export function loadActiveGeneratedSkills(cwd = process.cwd()): SkillCandidate[] {
  const project = resolveProjectForCwd(cwd)?.project;
  if (!project) return [];
  return readJson<CandidateStore>(candidatePath(project), {
    version: 1,
    candidates: [],
  }).candidates.filter((entry) => {
    if (entry.status !== 'active' || entry.project !== project || !entry.path || !entry.skillHash) {
      return false;
    }
    const expected = join(skillRoot('project', project), entry.skillId, 'SKILL.md');
    return (
      resolve(entry.path) === resolve(expected) &&
      existsSync(entry.path) &&
      fingerprint(readFileSync(entry.path, 'utf8')) === entry.skillHash
    );
  });
}

export function listSkillCandidates(project: string): SkillCandidate[] {
  return readJson<CandidateStore>(candidatePath(project), { version: 1, candidates: [] }).candidates;
}

export function skillLifecycleMetrics(project: string): Record<string, number> {
  const candidates = listSkillCandidates(project);
  const active = candidates.filter((entry) => entry.status === 'active');
  const promoted = candidates.filter((entry) => Boolean(entry.promotedAt));
  const uses = candidates.reduce((total, entry) => total + entry.performance.uses, 0);
  const successes = candidates.reduce((total, entry) => total + entry.performance.successes, 0);
  return {
    candidates: candidates.filter((entry) => entry.status === 'candidate' || entry.status === 'review').length,
    active: active.length,
    deprecated: candidates.filter((entry) => entry.status === 'deprecated').length,
    promotions: promoted.length,
    promotionRate: candidates.length === 0 ? 0 : promoted.length / candidates.length,
    retrievalUses: uses,
    successfulUses: successes,
    successWhenUsed: uses === 0 ? 0 : successes / uses,
  };
}

export function recordSkillOutcome(input: { project: string; ids: readonly string[]; success: boolean; durationMs?: number; cost?: number }): void {
  if (input.ids.length === 0) return;
  const path = candidatePath(input.project);
  withStoreLock(path, () => {
  const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
  let changed = false;
  for (const entry of store.candidates) {
    if (!input.ids.includes(entry.skillId) || entry.status !== 'active') continue;
    entry.performance.uses += 1;
    if (input.success) entry.performance.successes += 1;
    else entry.performance.failures += 1;
    entry.performance.totalDurationMs += Math.max(0, input.durationMs ?? 0);
    entry.performance.totalCost += Math.max(0, input.cost ?? 0);
    entry.performance.lastUsedAt = new Date().toISOString();
    if (entry.performance.uses >= 3 && entry.performance.successes / entry.performance.uses < 0.5) {
      entry.status = 'deprecated';
      entry.deprecatedAt = new Date().toISOString();
    }
    entry.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) atomicWrite(path, store);
  });
}

export function deprecateGeneratedSkill(project: string, id: string): SkillCandidate {
  const path = candidatePath(project);
  return withStoreLock(path, () => {
  const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
  const entry = store.candidates.find((candidate) => candidate.skillId === id && candidate.status === 'active');
  if (!entry) throw new Error(`active generated skill not found: ${id}`);
  entry.status = 'deprecated';
  entry.deprecatedAt = new Date().toISOString();
  entry.updatedAt = new Date().toISOString();
  atomicWrite(path, store);
  return entry;
  });
}

export function restoreGeneratedSkill(project: string, id: string): SkillCandidate {
  const path = candidatePath(project);
  return withStoreLock(path, () => {
    const store = readJson<CandidateStore>(path, { version: 1, candidates: [] });
    const entry = store.candidates.find(
      (candidate) => candidate.skillId === id && candidate.status === 'deprecated',
    );
    if (!entry) throw new Error(`deprecated generated skill not found: ${id}`);
    if (!entry.path || !entry.skillHash || !existsSync(entry.path)) {
      throw new Error(`deprecated generated skill cannot be restored without its validated file: ${id}`);
    }
    if (fingerprint(readFileSync(entry.path, 'utf8')) !== entry.skillHash) {
      throw new Error(`deprecated generated skill content changed before restore: ${id}`);
    }
    entry.status = 'active';
    entry.restoredAt = new Date().toISOString();
    entry.updatedAt = entry.restoredAt;
    atomicWrite(path, store);
    return entry;
  });
}

export function skillPerformanceScore(entry: SkillCandidate): number {
  if (entry.performance.uses === 0) return 0;
  return Math.round((entry.performance.successes / entry.performance.uses - 0.5) * 10);
}
