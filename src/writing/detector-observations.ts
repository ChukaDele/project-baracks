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
  const valid = observations.map((item) => {
    if (!item.detector.trim() || !item.version.trim() || !item.model.trim())
      throw new Error('detector observations require detector, version, and model');
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1)
      throw new Error('detector score must be between 0 and 1');
    if (!/^\d{4}-\d{2}-\d{2}/.test(item.observedAt) || item.limitations.length === 0)
      throw new Error('detector observations require date and limitations');
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
