import {
  LEARNING_SCOPES,
  LEARNING_SOURCES,
  LEARNING_STATUSES,
  dismissGlobalLearning,
  dismissLearning,
  learningReviewDue,
  listLearningCandidates,
  promoteLearning,
  type LearningScope,
  type LearningSource,
  type LearningStatus,
} from './candidates.js';
import { resolveProject } from '../supervisor/state.js';
import { buildLearningDigest, formatLearningDigest } from './digest.js';
import { captureLearningOrQueue, drainLearningQueue } from './queue.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function learningSource(value: string): LearningSource {
  if (!LEARNING_SOURCES.includes(value as LearningSource)) {
    throw new Error(`unsupported learning source: ${value}`);
  }
  return value as LearningSource;
}

function learningScope(value: string): LearningScope {
  if (!LEARNING_SCOPES.includes(value as LearningScope)) {
    throw new Error(`unsupported learning scope: ${value}`);
  }
  return value as LearningScope;
}

function learningStatus(value: string): LearningStatus {
  if (!LEARNING_STATUSES.includes(value as LearningStatus)) {
    throw new Error(`unsupported learning status: ${value}`);
  }
  return value as LearningStatus;
}

function promotionScope(value: string): Exclude<LearningScope, 'undecided'> {
  if (value !== 'project' && value !== 'global') {
    throw new Error('promotion scope must be project or global');
  }
  return value;
}

export async function runLearningLifecycleCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'learn') return false;

  if (args[1] === 'capture') {
    const project = resolveProject(flag(args, '--project') ?? 'current');
    const key = flag(args, '--key');
    // Store-lock contention or I/O failure queues the capture; it never fails the caller.
    const result = captureLearningOrQueue({
      source: learningSource(required(args, '--source')),
      summary: required(args, '--summary'),
      scope: learningScope(flag(args, '--scope') ?? 'undecided'),
      project: project.project,
      repoPath: project.repoPath,
      ...(key ? { key } : {}),
      ...(flag(args, '--evidence') ? { evidence: flag(args, '--evidence') } : {}),
    });
    console.log(
      JSON.stringify(
        result.queued ? { queued: true, reason: result.reason } : result.candidate,
        null,
        2,
      ),
    );
    return true;
  }

  if (args[1] === 'digest') {
    const digest = buildLearningDigest({
      since: flag(args, '--since'),
      selfWorkTarget: flag(args, '--self-work-target'),
      catalogPath: flag(args, '--catalog'),
    });
    console.log(
      args.includes('--json') ? JSON.stringify(digest, null, 2) : formatLearningDigest(digest),
    );
    return true;
  }

  if (args[1] === 'drain') {
    console.log(JSON.stringify(drainLearningQueue(), null, 2));
    return true;
  }

  if (args[1] === 'list') {
    const projectArg = flag(args, '--project');
    const resolved = projectArg ? resolveProject(projectArg) : undefined;
    const project = resolved?.project;
    const statusArg = flag(args, '--status');
    const candidates = listLearningCandidates(
      project,
      statusArg ? learningStatus(statusArg) : undefined,
      resolved?.repoPath,
    );
    if (args.includes('--json')) console.log(JSON.stringify(candidates, null, 2));
    else if (candidates.length === 0) console.log('No Major learning candidates.');
    else {
      for (const candidate of candidates) {
        console.log(
          `${candidate.status}\t${candidate.occurrences}x\t${candidate.scope}\t${candidate.key ?? '-'}\t${candidate.id}\t${candidate.summary}`,
        );
      }
    }
    return true;
  }

  if (args[1] === 'review') {
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const project = resolved.project;
    const due = learningReviewDue(project, resolved.repoPath);
    if (args.includes('--json')) console.log(JSON.stringify(due, null, 2));
    else if (due.length === 0)
      console.log('No Major learning candidates require promotion review.');
    else {
      for (const candidate of due) {
        console.log(
          `${candidate.occurrences}x\t${candidate.scope}\t${candidate.key ?? '-'}\t${candidate.id}\t${candidate.summary}`,
        );
      }
    }
    return true;
  }

  if (args[1] === 'promote') {
    const scope = promotionScope(required(args, '--scope'));
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const project = resolved.project;
    const candidate = promoteLearning({
      id: required(args, '--id'),
      project,
      scope,
      evidence: required(args, '--evidence'),
      repoPath: resolved.repoPath,
      ...(scope === 'global' ? { summary: required(args, '--summary') } : {}),
    });
    console.log(JSON.stringify(candidate, null, 2));
    return true;
  }

  if (args[1] === 'dismiss') {
    if (args.includes('--global')) {
      const candidate = dismissGlobalLearning({
        id: required(args, '--id'),
        evidence: required(args, '--evidence'),
      });
      console.log(JSON.stringify(candidate, null, 2));
      return true;
    }
    const resolved = resolveProject(flag(args, '--project') ?? 'current');
    const project = resolved.project;
    const candidate = dismissLearning({
      id: required(args, '--id'),
      project,
      evidence: required(args, '--evidence'),
      repoPath: resolved.repoPath,
    });
    console.log(JSON.stringify(candidate, null, 2));
    return true;
  }

  return false;
}
