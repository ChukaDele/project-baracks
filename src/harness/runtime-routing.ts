export const DSH_EXECUTION_ENVIRONMENTS = ['lima', 'local'] as const;
export type DshExecutionEnvironment = (typeof DSH_EXECUTION_ENVIRONMENTS)[number];

export interface DshRuntimeRoute {
  environment: DshExecutionEnvironment;
}

/**
 * Provider selection and execution environment are deliberately independent.
 * This route is retained for explicit DSH compatibility operations. Normal
 * execution uses the headless Major host path. Lima selects the same native
 * provider adapter behind the high-isolation environment. Legacy selects the
 * old Major/Lima CLI compatibility path and is never implicit.
 */
export function configuredDshRuntimeRoute(
  env: NodeJS.ProcessEnv = process.env,
): DshRuntimeRoute | undefined {
  const environment = env.MAJOR_DSH_EXECUTION_ENVIRONMENT;
  if (environment === undefined || environment === '' || environment === 'local') {
    return { environment: 'local' };
  }
  if (environment === 'legacy') return undefined;
  if (environment !== 'local' && environment !== 'lima') {
    throw new Error(`unsupported DSH execution environment: ${environment}`);
  }
  return { environment };
}
