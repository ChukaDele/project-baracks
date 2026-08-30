import { createHash } from 'node:crypto';
import { diagnoseProse } from './diagnostics.js';

type Evidence = { value: number | null; unit: 'ratio' | 'words'; note: string };
export interface VoiceFingerprint {
  schemaVersion: 2;
  profileId: string;
  corpusSha256: string;
  sampleCount: number;
  wordCount: number;
  features: Record<string, number | null>;
  featureEvidence: Record<string, Evidence>;
  distributions: Record<string, number[] | Record<string, number>>;
  repeatedPhrases: Array<{ phrase: string; count: number }>;
  characteristicVocabulary: Array<{ word: string; rate: number }>;
  constraints: readonly ['descriptive-only', 'no-biography-inference', 'no-author-or-ai-labels'];
}
export interface VoiceDeviationReport {
  schemaVersion: 2;
  profileId: string;
  profileCorpusSha256: string;
  candidateWordCount: number;
  deviations: Record<
    string,
    { expected: number; actual: number; relativeDeviation: number; evidence: Evidence }
  >;
  insufficientEvidence: boolean;
}
const FUNCTION_WORDS = ['and', 'but', 'or', 'because', 'if', 'that', 'which', 'the', 'a', 'to'];
const TRANSITIONS = ['however', 'therefore', 'instead', 'meanwhile', 'for example', 'because'];

export function buildVoiceFingerprint(
  profileId: string,
  approvedSamples: readonly string[],
): VoiceFingerprint {
  const words = approvedSamples.join(' ').match(/[A-Za-z]+/g)?.length ?? 0;
  if (approvedSamples.length < 3 || words < 300)
    throw new Error('voice fingerprint requires at least 3 approved samples and 300 words');
  return fingerprint(profileId, approvedSamples.length, approvedSamples.join('\n\n'));
}
function fingerprint(profileId: string, sampleCount: number, corpus: string): VoiceFingerprint {
  const d = diagnoseProse(corpus);
  const words = corpus.toLowerCase().match(/\b[a-z]+(?:'[a-z]+)?\b/g) ?? [];
  const sentences = corpus.split(/(?<=[.!?])\s+/u).filter((v) => v.trim());
  const sentenceLengths = sentences.map((v) => v.match(/[A-Za-z]+/g)?.length ?? 0);
  const paragraphLengths = corpus
    .split(/\n\s*\n/u)
    .map((v) => v.match(/[A-Za-z]+/g)?.length ?? 0)
    .filter(Boolean);
  const rate = (pattern: RegExp) =>
    (corpus.match(pattern) ?? []).length / Math.max(1, words.length);
  const tokenRate = (token: string) =>
    words.filter((word) => word === token).length / Math.max(1, words.length);
  const punctuation = Object.fromEntries(
    [',', ';', ':', '!', '?', '(', ')'].map((mark) => [mark, corpus.split(mark).length - 1]),
  );
  const functionWords = Object.fromEntries(FUNCTION_WORDS.map((word) => [word, tokenRate(word)]));
  const transitions = Object.fromEntries(
    TRANSITIONS.map((phrase) => [
      phrase,
      (corpus.toLowerCase().match(new RegExp(`\\b${phrase.replace(' ', '\\s+')}\\b`, 'gu')) ?? [])
        .length / Math.max(1, sentences.length),
    ]),
  );
  const shapes = {
    questionOpening:
      sentences.filter((v) => /^(?:why|how|what|when|where|who)\b/iu.test(v)).length /
      Math.max(1, sentences.length),
    conjunctionOpening:
      sentences.filter((v) => /^(?:and|but|so|because)\b/iu.test(v)).length /
      Math.max(1, sentences.length),
    shortSentence: sentenceLengths.filter((v) => v <= 7).length / Math.max(1, sentences.length),
    longSentence: sentenceLengths.filter((v) => v >= 25).length / Math.max(1, sentences.length),
  };
  const phrases = new Map<string, number>();
  for (let i = 0; i <= words.length - 3; i += 1) {
    const phrase = words.slice(i, i + 3).join(' ');
    phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
  }
  const repeatedPhrases = [...phrases]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }));
  const characteristicVocabulary =
    words.length < 600
      ? []
      : [...new Set(words)]
          .filter((word) => word.length >= 5 && !FUNCTION_WORDS.includes(word))
          .map((word) => ({ word, rate: tokenRate(word) }))
          .filter((v) => v.rate >= 0.003)
          .sort((a, b) => b.rate - a.rate || a.word.localeCompare(b.word))
          .slice(0, 30);
  const features: Record<string, number | null> = {
    sentenceLengthMean: d.sentenceLength.mean,
    sentenceLengthVariance: variance(sentenceLengths),
    sentenceLengthCv: d.sentenceLength.coefficientOfVariation,
    paragraphLengthMean: d.paragraphLength.mean,
    paragraphLengthVariance: variance(paragraphLengths),
    paragraphLengthCv: d.paragraphLength.coefficientOfVariation,
    lexicalDiversity: d.lexicalDiversity,
    contractionRate: rate(/\b\w+'(?:t|s|re|ve|ll|d|m)\b/giu),
    firstPersonRate: rate(/\b(?:i|me|my|mine|we|us|our|ours)\b/giu),
    functionWordRate: Object.values(functionWords).reduce((a, b) => a + b, 0),
    transitionRate: Object.values(transitions).reduce((a, b) => a + b, 0),
    questionRate: punctuation['?']! / Math.max(1, sentences.length),
    commaRate: punctuation[',']! / Math.max(1, words.length),
    semicolonRate: punctuation[';']! / Math.max(1, words.length),
    colonRate: punctuation[':']! / Math.max(1, words.length),
    parenthesisRate: (punctuation['(']! + punctuation[')']!) / Math.max(1, words.length),
    repeatedPhraseRate:
      repeatedPhrases.reduce((sum, v) => sum + v.count, 0) / Math.max(1, words.length),
    abstractWordRate:
      words.filter((word) => /(?:tion|ment|ness|ity|ism|ance|ence)$/u.test(word)).length /
      Math.max(1, words.length),
    concreteProxyRate: words.filter((word) => word.length <= 4).length / Math.max(1, words.length),
    shortSentenceRate: shapes.shortSentence,
    longSentenceRate: shapes.longSentence,
    conjunctionOpeningRate: shapes.conjunctionOpening,
  };
  return {
    schemaVersion: 2,
    profileId,
    corpusSha256: createHash('sha256').update(corpus).digest('hex'),
    sampleCount,
    wordCount: words.length,
    features,
    featureEvidence: Object.fromEntries(
      Object.entries(features).map(([key, value]) => [
        key,
        {
          value,
          unit:
            key.includes('Length') && !key.endsWith('Rate') && !key.endsWith('Cv')
              ? 'words'
              : 'ratio',
          note: 'Descriptive approved-corpus metric; no identity or authorship inference.',
        },
      ]),
    ),
    distributions: {
      sentenceLength: sentenceLengths,
      paragraphLength: paragraphLengths,
      punctuation,
      functionWords,
      transitions,
      syntacticShapes: shapes,
    },
    repeatedPhrases,
    characteristicVocabulary,
    constraints: ['descriptive-only', 'no-biography-inference', 'no-author-or-ai-labels'],
  };
}
export function compareVoiceFingerprint(
  profile: VoiceFingerprint,
  text: string,
): VoiceDeviationReport {
  const candidate = fingerprint('candidate', 1, text);
  const deviations: VoiceDeviationReport['deviations'] = {};
  for (const [key, expected] of Object.entries(profile.features)) {
    const actual = candidate.features[key];
    if (expected === null || actual == null) continue;
    deviations[key] = {
      expected,
      actual,
      relativeDeviation:
        Math.round((Math.abs(actual - expected) / Math.max(0.01, Math.abs(expected))) * 1000) /
        1000,
      evidence: candidate.featureEvidence[key]!,
    };
  }
  return {
    schemaVersion: 2,
    profileId: profile.profileId,
    profileCorpusSha256: profile.corpusSha256,
    candidateWordCount: candidate.wordCount,
    deviations,
    insufficientEvidence: candidate.wordCount < 300,
  };
}
function variance(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}
