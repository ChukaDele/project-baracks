import { learningReviewDue, promoteLearning, type LearningScope } from './candidates.js';
import { resolveProject } from '../supervisor/state.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function promotionScope(value: string): Exclude<LearningScope, 'undecided'> {
  if (value !== 'project' && value !== 'global') {
    throw new Error('promotion scope must be project or global');
  }
  return value;
}

export async function runLearningLifecycleCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'learn') return false;

  if (args[1] === 'review') {
    const projectArg = flag(args, '--project');
    const project = projectArg ? resolveProject(projectArg).project : undefined;
    const due = learningReviewDue(project);
    if (args.includes('--json')) console.log(JSON.stringify(due, null, 2));
    else if (due.length === 0) console.log('No Major learning candidates require promotion review.');
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
    const candidate = promoteLearning({
      id: required(args, '--id'),
      scope: promotionScope(required(args, '--scope')),
      ...(flag(args, '--evidence') ? { evidence: flag(args, '--evidence') } : {}),
    });
    console.log(JSON.stringify(candidate, null, 2));
    return true;
  }

  return false;
}
