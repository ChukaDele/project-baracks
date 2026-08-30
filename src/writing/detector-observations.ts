export interface DetectorObservation {
  detector: string;
  version: string;
  score: number;
  genre: string;
  model: string;
  observedAt: string;
  limitations: string[];
}

export interface DetectorObservationReport {
  version: 1;
  role: 'diagnostic-only';
  qualityGate: false;
  evasionTrigger: false;
  observations: DetectorObservation[];
  agreement: 'none' | 'agreement' | 'disagreement' | 'indeterminate';
}

export function observeDetectors(
  observations: readonly DetectorObservation[],
): DetectorObservationReport {
  if (observations.length > 32) throw new Error('detector observations exceed the bounded limit');
  try {
    if (Buffer.byteLength(JSON.stringify(observations), 'utf8') > 100_000)
      throw new Error('detector observations exceed the bounded payload');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('detector observations exceed'))
      throw error;
    throw new Error('detector observations must be serializable');
  }
  const bounded = (value: unknown, maximum: number): value is string =>
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    Buffer.byteLength(value, 'utf8') <= maximum;
  const valid = observations.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('detector observations must be objects');
    if (
      Object.keys(item).some(
        (key) =>
          !['detector', 'version', 'score', 'genre', 'model', 'observedAt', 'limitations'].includes(
            key,
          ),
      )
    )
      throw new Error('detector observations contain unknown fields');
    if (
      !bounded(item.detector, 200) ||
      !bounded(item.version, 100) ||
      !bounded(item.genre, 100) ||
      !bounded(item.model, 200)
    )
      throw new Error('detector observations require bounded identity fields');
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1)
      throw new Error('detector score must be between 0 and 1');
    if (
      !/^\d{4}-\d{2}-\d{2}/u.test(item.observedAt) ||
      Buffer.byteLength(item.observedAt, 'utf8') > 40 ||
      !Array.isArray(item.limitations) ||
      item.limitations.length === 0 ||
      item.limitations.length > 16 ||
      item.limitations.some((limitation) => !bounded(limitation, 1_000))
    )
      throw new Error('detector observations require bounded date and limitations');
    return { ...item, limitations: [...item.limitations] };
  });
  const buckets = new Set(valid.map((item) => (item.score >= 0.5 ? 'high' : 'low')));
  return {
    version: 1,
    role: 'diagnostic-only',
    qualityGate: false,
    evasionTrigger: false,
    observations: valid,
    agreement:
      valid.length === 0
        ? 'none'
        : valid.length === 1
          ? 'indeterminate'
          : buckets.size === 1
            ? 'agreement'
            : 'disagreement',
  };
}
