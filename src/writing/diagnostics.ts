import type { WritingFinding, WritingGenre } from './types.js';

export interface ProseDiagnostics {
  version: 2;
  engine: { id: 'major-contextual-prose-diagnostics'; version: 2; mode: 'detect-only' };
  critic: {
    id: 'natural-writing-qa';
    mode: 'detect-only';
    upstream: readonly [
      'conorbronsdon/avoid-ai-writing',
      'blader/humanizer',
      'brandonwise/humanizer',
    ];
  };
  profile: WritingGenre;
  exclusions: { fencedCodeBlocks: number; inlineCodeSpans: number; quotedLines: number };
  words: number;
  sentences: number;
  paragraphs: number;
  sentenceLength: { mean: number; coefficientOfVariation: number };
  paragraphLength: { mean: number; coefficientOfVariation: number };
  lexicalDiversity: number | null;
  repeatedTrigramRate: number | null;
  fleschReadingEase: number | null;
  fleschKincaidGrade: number | null;
  confidence: 'low' | 'medium' | 'high';
  findings: WritingFinding[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const variation = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return 0;
  return (
    Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean
  );
};
const syllables = (word: string): number =>
  Math.max(
    1,
    (
      word
        .toLowerCase()
        .replace(/e$/u, '')
        .match(/[aeiouy]+/gu) ?? []
    ).length,
  );

export function diagnoseProse(text: string, genre: WritingGenre = 'general'): ProseDiagnostics {
  const withoutFencedCode = text.replace(/```[\s\S]*?```/gu, ' ');
  const exclusions = {
    fencedCodeBlocks: (text.match(/```[\s\S]*?```/gu) ?? []).length,
    inlineCodeSpans: (withoutFencedCode.match(/`[^`]*`/gu) ?? []).length,
    quotedLines: (text.match(/^\s*>.*$/gmu) ?? []).length,
  };
  const withoutCode = withoutFencedCode.replace(/`[^`]*`/gu, ' ').replace(/^\s*>.*$/gmu, ' ');
  const tokens = withoutCode.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/gu) ?? [];
  const sentenceTexts = withoutCode
    .split(/(?<=[.!?])\s+/u)
    .map((v) => v.trim())
    .filter(Boolean);
  const sentenceLengths = sentenceTexts
    .map((v) => (v.match(/[a-z]+(?:'[a-z]+)?/giu) ?? []).length)
    .filter(Boolean);
  const paragraphLengths = withoutCode
    .split(/\n\s*\n/u)
    .map((v) => (v.match(/[a-z]+(?:'[a-z]+)?/giu) ?? []).length)
    .filter(Boolean);
  const trigrams = tokens.slice(2).map((_, i) => tokens.slice(i, i + 3).join(' '));
  const repeated = trigrams.length - new Set(trigrams).size;
  const findings: WritingFinding[] = [];
  const rules: Array<[string, RegExp, string, string, WritingFinding['severity']]> = [
    [
      'major.writing.punctuation',
      /[—]|(?:\s--\s)/u,
      'punctuation',
      'Em dash or double-hyphen prose punctuation; confirm it is intentional for this profile.',
      genre === 'technical' ? 'info' : 'warning',
    ],
    [
      'major.aiisms.canned-transition',
      /\b(?:it is important to note|in today'?s rapidly evolving|let'?s dive in|as we move forward|in conclusion)\b/iu,
      'canned-transition',
      'Canned transition or filler phrase.',
      'warning',
    ],
    [
      'major.clarity.vague-attribution',
      /\b(?:studies show|experts believe|research suggests)\b(?![^.]{0,100}\b(?:by|from|\d{4})\b)/iu,
      'vague-attribution',
      'Attribution is not traceable in the sentence.',
      'error',
    ],
    [
      'major.writing.negative-parallelism',
      /\bnot\s+[^,.]{1,45},?\s+but\s+/iu,
      'negative-parallelism',
      'Check whether the not-X-but-Y construction earns its emphasis.',
      'warning',
    ],
    [
      'major.aiisms.contextual-vocabulary',
      /\b(?:delve|tapestry|landscape|testament|pivotal|transformative|revolutionary)\b/iu,
      'contextual-vocabulary',
      'Potentially generic AI-associated vocabulary; keep only when precise in context.',
      genre === 'academic' || genre === 'technical' ? 'info' : 'warning',
    ],
    [
      'major.aiisms.chatbot-artifact',
      /\b(?:certainly|absolutely|great question)[,!]/iu,
      'chatbot-artifact',
      'Chatbot-style opening.',
      'warning',
    ],
  ];
  for (const [ruleId, pattern, dimension, message, severity] of rules) {
    const match = withoutCode.match(pattern);
    if (match)
      findings.push({
        ruleId,
        dimension,
        severity,
        message,
        evidence: match[0],
        profile: genre,
        suppression: {
          eligible: severity !== 'error',
          reason:
            'Suppress only with quoted, technical, source-faithful, or approved-voice evidence.',
        },
      });
  }
  if ((withoutCode.match(/^#{1,6}\s/gmu) ?? []).length > 3 && tokens.length < 300)
    findings.push({
      dimension: 'structure',
      severity: 'warning',
      message: 'Excessive headings for a short text.',
    });
  const ease =
    sentenceLengths.length && tokens.length
      ? 206.835 -
        1.015 * (tokens.length / sentenceLengths.length) -
        84.6 * (tokens.reduce((sum, word) => sum + syllables(word), 0) / tokens.length)
      : null;
  const grade =
    sentenceLengths.length && tokens.length
      ? 0.39 * (tokens.length / sentenceLengths.length) +
        11.8 * (tokens.reduce((sum, word) => sum + syllables(word), 0) / tokens.length) -
        15.59
      : null;
  if (ease !== null && genre === 'transactional' && ease < 45)
    findings.push({
      dimension: 'readability',
      severity: 'warning',
      message: 'Transactional prose is unusually difficult to read.',
    });
  return {
    version: 2,
    engine: { id: 'major-contextual-prose-diagnostics', version: 2, mode: 'detect-only' },
    critic: {
      id: 'natural-writing-qa',
      mode: 'detect-only',
      upstream: ['conorbronsdon/avoid-ai-writing', 'blader/humanizer', 'brandonwise/humanizer'],
    },
    profile: genre,
    exclusions,
    words: tokens.length,
    sentences: sentenceLengths.length,
    paragraphs: paragraphLengths.length,
    sentenceLength: {
      mean: round(tokens.length / Math.max(1, sentenceLengths.length)),
      coefficientOfVariation: round(variation(sentenceLengths)),
    },
    paragraphLength: {
      mean: round(tokens.length / Math.max(1, paragraphLengths.length)),
      coefficientOfVariation: round(variation(paragraphLengths)),
    },
    lexicalDiversity: tokens.length >= 50 ? round(new Set(tokens).size / tokens.length) : null,
    repeatedTrigramRate: trigrams.length >= 20 ? round(repeated / trigrams.length) : null,
    fleschReadingEase: ease === null ? null : round(ease),
    fleschKincaidGrade: grade === null ? null : round(grade),
    confidence: tokens.length < 80 ? 'low' : tokens.length < 250 ? 'medium' : 'high',
    findings,
  };
}
