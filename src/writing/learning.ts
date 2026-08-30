import { captureLearning, type LearningCandidate } from '../learning/candidates.js';
import { createHash } from 'node:crypto';

export const WRITING_LEARNING_SCOPES = [
  'global',
  'genre',
  'brand',
  'personal-voice',
  'project',
  'one-off',
] as const;
export type WritingLearningScope = (typeof WRITING_LEARNING_SCOPES)[number];

export function captureAcceptedWritingEdit(input: {
  summary: string;
  evidence: string;
  classification: WritingLearningScope;
  project?: string;
  repoPath?: string;
  accepted: boolean;
}): LearningCandidate {
  const scope = input.classification === 'one-off' ? 'undecided' : 'project';
  return captureLearning({
    source: 'user-correction',
    key: `writing-${input.classification}-${input.accepted ? 'accepted' : 'rejected'}-${createHash('sha256').update(`${input.summary}\0${input.evidence}`).digest('hex').slice(0, 16)}`,
    summary: `[writing:${input.classification}] ${input.summary}`,
    evidence: input.evidence,
    scope,
    project: input.project,
    repoPath: input.repoPath,
  });
}
