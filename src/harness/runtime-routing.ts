export const DSH_EXECUTION_ENVIRONMENTS = ['lima', 'local'] as const;
export type DshExecutionEnvironment = (typeof DSH_EXECUTION_ENVIRONMENTS)[number];

export interface DshRuntimeRoute {
  environment: DshExecutionEnvironment;
}

/**
 * First strangle checkpoint. Provider selection and execution environment are
 * deliberately independent: later Lima composition can reuse the provider
 * adapter without making the workstation environment part of provider policy.
 * Unset configuration returns undefined and therefore preserves `major run`
 * plus Lima as the compatibility default until both native environments pass
 * acceptance. An explicit `lima` selects the DSH-native Lima environment.
 */
export function configuredDshRuntimeRoute(
  env: NodeJS.ProcessEnv = process.env,
): DshRuntimeRoute | undefined {
  const environment = env.MAJOR_DSH_EXECUTION_ENVIRONMENT;
  if (environment === undefined || environment === '') return undefined;
  if (environment !== 'local' && environment !== 'lima') {
    throw new Error(`unsupported DSH execution environment: ${environment}`);
  }
  return { environment };
}
