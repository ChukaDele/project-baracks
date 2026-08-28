import { readFileSync } from 'node:fs';
import { captureLearning } from '../learning/candidates.js';
import { resolveProject } from '../supervisor/state.js';
import type { KnowledgeFact } from './semantics.js';
import {
  ingestKnowledge,
  type KnowledgeBoundaries,
  type KnowledgeInputRecord,
  type KnowledgeMeaning,
} from './workflow.js';

const MAX_RECORDS = 100;
const flag = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const required = (args: string[], name: string): string => {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
};
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export function learningKnowledgeBoundary(input: {
  project: string;
  repoPath: string;
}): KnowledgeBoundaries {
  return {
    captureMeaning(meaning: KnowledgeMeaning) {
      captureLearning({
        source: 'successful-procedure',
        summary: meaning.summary,
        scope: 'project',
        project: input.project,
        repoPath: input.repoPath,
        evidence: `${meaning.kind}:${meaning.sourceLocator}#${meaning.retrievalId}@${meaning.observedAt}`,
      });
    },
  };
}

export async function runKnowledgeCli(
  args: string[],
  boundaryFactory = learningKnowledgeBoundary,
): Promise<boolean> {
  if (args[0] !== 'knowledge' || args[1] !== 'ingest') return false;
  const resolved = resolveProject(flag(args, '--project') ?? 'current');
  const payload = json(required(args, '--input')) as {
    records?: KnowledgeInputRecord[];
    existing?: KnowledgeFact[];
  };
  if (!Array.isArray(payload.records)) throw new Error('knowledge input requires a records array');
  if (payload.existing !== undefined && !Array.isArray(payload.existing)) {
    throw new Error('knowledge input existing snapshot must be an array');
  }
  const kinds = new Set(['source-claim', 'user-conclusion', 'major-conclusion']);
  if (payload.records.some((record) => !record || !kinds.has(record.kind))) {
    throw new Error(
      'knowledge records must classify kind as source-claim, user-conclusion or major-conclusion',
    );
  }
  const receipt = ingestKnowledge(
    payload.records,
    payload.existing ?? [],
    boundaryFactory(resolved),
    MAX_RECORDS,
  );
  console.log(JSON.stringify(receipt, null, 2));
  return true;
}
