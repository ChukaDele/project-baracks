export const WRITING_GENRES = [
  'academic',
  'brand',
  'personal-brand',
  'direct-response',
  'technical',
  'report',
  'proposal',
  'transactional',
  'general',
] as const;
export type WritingGenre = (typeof WRITING_GENRES)[number];
export type WritingRisk = 'routine' | 'high-stakes';
export const CANONICAL_WRITING_PIPELINE = [
  'brief',
  'writing-os',
  'specialist-strategy',
  'research-evidence',
  'prose-craft',
  'voice',
  'draft',
  'deterministic-prose-lint',
  'natural-writing-qa',
  'substantive-writing-evaluator',
  'independent-red-team-when-required',
  'targeted-revision',
  'final-verification',
  'output',
  'learning',
] as const;
export const TRANSACTIONAL_WRITING_PIPELINE = [
  'brief',
  'writing-os',
  'prose-craft',
  'draft',
  'natural-writing-qa',
  'final-verification',
  'output',
  'learning',
] as const;
export type WritingPipelineStage = (typeof CANONICAL_WRITING_PIPELINE)[number];
export type WritingGate =
  | 'route'
  | 'draft'
  | 'prose-lint'
  | 'natural-writing-qa'
  | 'substantive-evaluation'
  | 'independent-red-team'
  | 'revision'
  | 'source-claim-check'
  | 'final-verification';

export interface WritingRoute {
  substantive: boolean;
  transactional: boolean;
  genre: WritingGenre;
  risk: WritingRisk;
  skills: string[];
  reasons: Record<string, string>;
  pipelineStages: readonly WritingPipelineStage[];
  gates: WritingGate[];
  lintProfile: 'general' | 'academic' | 'marketing' | 'technical' | 'asd-ste100' | 'transactional';
  voiceProfile?: string;
}

export interface WritingFinding {
  ruleId?: string;
  dimension: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  evidence?: string;
  profile?: string;
  suppression?: {
    eligible: boolean;
    reason?: string;
  };
}
