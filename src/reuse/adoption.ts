import { readFileSync } from 'node:fs';

const REQUIRED_SECTIONS = [
  'Problem',
  'Existing options considered',
  'Chosen option',
  'Why',
  'What we reuse',
  'What we tailor',
  'What we will not build',
  'License and version',
  'Exit strategy',
  'Evidence',
] as const;

const PLACEHOLDER = /^\s*(?:\[[^\]]+\]|todo|tbd|n\/a)\s*\.?\s*$/i;
const CELL_PLACEHOLDER = /^(?:x|-|none|n\/a|todo|tbd|\[[^\]]+\])$/i;
const SEARCH_LAYERS = [
  'Current repository',
  'Major skills/templates',
  'Current dependencies',
  'Official platform',
  'Maintained upstream',
  'Available tool/service',
] as const;
const EVIDENCE_MARKER =
  /\b(?:test|command|https?:\/\/|file|commit|sha|audit|version|trace|screenshot)\b/i;

export interface AdoptionRecordCheck {
  valid: boolean;
  missingSections: string[];
  emptySections: string[];
  missingSearchLayers: string[];
  evidenceInsufficient: boolean;
  customBuildGapMissing: boolean;
}

function sectionBody(markdown: string, heading: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines
    .slice(start + 1, end < 0 ? lines.length : end)
    .join('\n')
    .trim();
}

export function checkAdoptionRecord(markdown: string): AdoptionRecordCheck {
  const missingSections: string[] = [];
  const emptySections: string[] = [];
  for (const heading of REQUIRED_SECTIONS) {
    const body = sectionBody(markdown, heading);
    if (body === undefined) missingSections.push(heading);
    else if (!body || body.length < 12 || PLACEHOLDER.test(body)) emptySections.push(heading);
  }
  const options = sectionBody(markdown, 'Existing options considered') ?? '';
  const missingSearchLayers = SEARCH_LAYERS.filter((layer) => {
    const row = options
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().includes(layer.toLowerCase()));
    if (!row) return true;
    const cells = row
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    const evidenceCells = cells
      .slice(1)
      .filter((cell) => cell.length >= 3 && !CELL_PLACEHOLDER.test(cell));
    return evidenceCells.length < 2;
  });
  const evidence = sectionBody(markdown, 'Evidence') ?? '';
  const evidenceInsufficient = evidence.length < 20 || !EVIDENCE_MARKER.test(evidence);
  const chosen = sectionBody(markdown, 'Chosen option') ?? '';
  const why = sectionBody(markdown, 'Why') ?? '';
  const customIntent =
    /\b(?:custom (?:build|implementation|code)|bespoke|from scratch|reimplement|build (?:it )?ourselves)\b/i;
  const customBuildGapMissing = customIntent.test(chosen) && !/\bunmet requirement\b/i.test(why);
  return {
    valid:
      missingSections.length === 0 &&
      emptySections.length === 0 &&
      missingSearchLayers.length === 0 &&
      !evidenceInsufficient &&
      !customBuildGapMissing,
    missingSections,
    emptySections,
    missingSearchLayers,
    evidenceInsufficient,
    customBuildGapMissing,
  };
}

export function checkAdoptionRecordFile(path: string): AdoptionRecordCheck {
  return checkAdoptionRecord(readFileSync(path, 'utf8'));
}
