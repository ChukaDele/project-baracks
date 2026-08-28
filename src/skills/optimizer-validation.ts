export interface PairedHeldOutEvidence {
  runIds: string[];
  taskIds: string[];
  baselineQuality: number[];
  candidateQuality: number[];
}

export interface SkillOptimizationEvidence {
  version: string;
  runIds: string[];
  taskIds: string[];
  baselineQuality: number[];
  candidateQuality: number[];
  baselineLatencyMs: number[];
  candidateLatencyMs: number[];
  baselineCost: number[];
  candidateCost: number[];
  heldOut?: PairedHeldOutEvidence;
  mutationExists: boolean;
  materialThreshold: number;
  rollbackTarget: string;
  postActivationFieldOutcome?: string;
}

export interface SkillOptimizationDecision {
  status: 'promotable' | 'inconclusive' | 'rejected';
  medianChangePercent?: number;
  reasons: string[];
}

const median = (values: number[]): number => {
  const rows = [...values].sort((a, b) => a - b);
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle]! : (rows[middle - 1]! + rows[middle]!) / 2;
};

const validMeasurements = (values: number[]): boolean =>
  values.every((value) => Number.isFinite(value) && value >= 0);

const validIdentities = (values: string[]): boolean =>
  values.every((value) => typeof value === 'string' && value.trim().length > 0);

export function validateSkillOptimization(
  input: SkillOptimizationEvidence,
): SkillOptimizationDecision {
  const reasons: string[] = [];
  if (!input.version.trim()) reasons.push('version-required');
  const comparableLength = input.runIds.length;
  const comparable = [
    input.taskIds,
    input.baselineQuality,
    input.candidateQuality,
    input.baselineLatencyMs,
    input.candidateLatencyMs,
    input.baselineCost,
    input.candidateCost,
  ];
  if (comparableLength < 3) reasons.push('three-comparable-runs-required');
  if (comparable.some((values) => values.length !== comparableLength)) {
    reasons.push('comparable-evidence-length-mismatch');
  }
  if (!validIdentities(input.runIds) || !validIdentities(input.taskIds)) {
    reasons.push('comparable-run-task-identity-required');
  }
  const comparablePairs = input.runIds.map((runId, index) => `${runId}\u0000${input.taskIds[index]}`);
  if (new Set(comparablePairs).size !== comparablePairs.length) {
    reasons.push('comparable-run-task-identity-must-be-unique');
  }
  if (
    ![
      input.baselineQuality,
      input.candidateQuality,
      input.baselineLatencyMs,
      input.candidateLatencyMs,
      input.baselineCost,
      input.candidateCost,
    ].every(validMeasurements)
  ) {
    reasons.push('finite-nonnegative-measurements-required');
  }
  if (input.mutationExists) {
    const heldOut = input.heldOut;
    if (!heldOut || heldOut.runIds.length === 0) {
      reasons.push('held-out-result-required-for-mutation');
    } else {
      const heldOutLength = heldOut.runIds.length;
      if (
        [heldOut.taskIds, heldOut.baselineQuality, heldOut.candidateQuality].some(
          (values) => values.length !== heldOutLength,
        )
      ) {
        reasons.push('held-out-evidence-length-mismatch');
      }
      if (!validIdentities(heldOut.runIds) || !validIdentities(heldOut.taskIds)) {
        reasons.push('held-out-run-task-identity-required');
      }
      if (!validMeasurements(heldOut.baselineQuality) || !validMeasurements(heldOut.candidateQuality)) {
        reasons.push('finite-nonnegative-held-out-results-required');
      }
      const heldOutPairs = heldOut.runIds.map(
        (runId, index) => `${runId}\u0000${heldOut.taskIds[index]}`,
      );
      if (
        new Set(heldOutPairs).size !== heldOutPairs.length ||
        heldOutPairs.some((pair) => comparablePairs.includes(pair))
      ) {
        reasons.push('real-held-out-pairing-required');
      }
    }
  }
  if (!Number.isFinite(input.materialThreshold) || input.materialThreshold <= 0) {
    reasons.push('material-threshold-required');
  }
  if (!input.rollbackTarget.trim()) reasons.push('rollback-target-required');
  if (!input.postActivationFieldOutcome?.trim()) {
    reasons.push('post-activation-field-outcome-required');
  }
  if (reasons.length) return { status: 'rejected', reasons };
  const baseline = median(input.baselineQuality);
  const change =
    baseline === 0
      ? median(input.candidateQuality) === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : ((median(input.candidateQuality) - baseline) / baseline) * 100;
  if (Math.abs(change) < 5) {
    return {
      status: 'inconclusive',
      medianChangePercent: change,
      reasons: ['within-five-percent-inconclusive-band'],
    };
  }
  if (change < input.materialThreshold) {
    return {
      status: 'rejected',
      medianChangePercent: change,
      reasons: ['below-material-threshold'],
    };
  }
  return { status: 'promotable', medianChangePercent: change, reasons: [] };
}
