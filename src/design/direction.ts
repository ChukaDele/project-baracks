import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const REQUIRED_FIELDS = [
  'Status',
  'Selected direction',
  'Approval source',
  'Approval evidence',
  'Conservative moodboard',
  'Progressive moodboard',
  'Exploratory moodboard',
  'Reference map',
  'Design contract',
] as const;
const APPROVAL_SOURCES = new Set(['owner-selected', 'approved-hybrid', 'owner-delegated']);
const PLACEHOLDER = /^(?:pending|todo|tbd|n\/a|\[[^\]]+\])$/i;

export interface DesignDirectionCheck {
  valid: boolean;
  missingFields: string[];
  invalidFields: string[];
  missingArtifacts: string[];
  escapedArtifacts: string[];
}

function field(markdown: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))?.[1]?.trim();
}

export function checkDesignDirectionRecord(markdown: string): DesignDirectionCheck {
  const missingFields = REQUIRED_FIELDS.filter((name) => !field(markdown, name));
  const invalidFields: string[] = [];
  for (const name of REQUIRED_FIELDS) {
    const value = field(markdown, name);
    if (value && (value.length < 4 || PLACEHOLDER.test(value))) invalidFields.push(name);
  }
  if (field(markdown, 'Status')?.toLowerCase() !== 'approved') invalidFields.push('Status');
  if (!APPROVAL_SOURCES.has(field(markdown, 'Approval source')?.toLowerCase() ?? '')) {
    invalidFields.push('Approval source');
  }
  return {
    valid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields: [...new Set(invalidFields)],
    missingArtifacts: [],
    escapedArtifacts: [],
  };
}

export function checkDesignDirectionRecordFile(
  path: string,
  projectRoot: string,
): DesignDirectionCheck {
  const root = realpathSync(projectRoot);
  const record = realpathSync(path);
  const recordRelative = relative(root, record);
  if (recordRelative.startsWith('..') || isAbsolute(recordRelative)) {
    throw new Error('design direction record must be inside the current project');
  }
  if (!recordRelative.startsWith(`design-research/`)) {
    throw new Error('design direction record must be under design-research/');
  }
  const markdown = readFileSync(record, 'utf8');
  const result = checkDesignDirectionRecord(markdown);
  const missingArtifacts: string[] = [];
  const escapedArtifacts: string[] = [];
  for (const name of REQUIRED_FIELDS.slice(4)) {
    const value = field(markdown, name);
    if (!value) continue;
    const target = resolve(dirname(record), value);
    if (!existsSync(target)) {
      missingArtifacts.push(name);
      continue;
    }
    const canonical = realpathSync(target);
    const targetRelative = relative(root, canonical);
    if (
      targetRelative.startsWith('..') ||
      isAbsolute(targetRelative) ||
      lstatSync(target).isSymbolicLink()
    ) {
      escapedArtifacts.push(name);
    }
  }
  return {
    ...result,
    valid: result.valid && missingArtifacts.length === 0 && escapedArtifacts.length === 0,
    missingArtifacts,
    escapedArtifacts,
  };
}
