export function executeCursorFieldPhase(execute, input) {
  return execute({
    phase: input.phase,
    nonce: input.nonce,
    ...(input.modelRef ? { modelRef: input.modelRef } : {}),
    ...(input.resumeSessionRef ? { resumeSessionRef: input.resumeSessionRef } : {}),
    ...(input.predecessorLeaseId ? { predecessorLeaseId: input.predecessorLeaseId } : {}),
  });
}
