import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const EXECUTION_PATHS = ['host', 'lima'] as const;
export type ExecutionPath = (typeof EXECUTION_PATHS)[number];

interface ExecutionPathConfig {
  version: 1;
  path: ExecutionPath;
  configuredAt: string;
}

function majorHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.MAJOR_HOME ?? join(homedir(), '.major'));
}

export function executionPathConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.MAJOR_EXECUTION_PATH_CONFIG ?? join(majorHome(env), 'execution-path.json'));
}

function parseExecutionPath(value: string, source: string): ExecutionPath {
  if (!EXECUTION_PATHS.includes(value as ExecutionPath)) {
    throw new Error(
      `unsupported Major execution path '${value}' in ${source}; expected host or lima`,
    );
  }
  return value as ExecutionPath;
}

function readConfig(env: NodeJS.ProcessEnv): ExecutionPathConfig | undefined {
  const path = executionPathConfigPath(env);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(
      `Major execution path config is unreadable at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Major execution path config is not an object: ${path}`);
  }
  const config = parsed as Partial<ExecutionPathConfig>;
  if (config.version !== 1 || typeof config.path !== 'string') {
    throw new Error(`Major execution path config is invalid: ${path}`);
  }
  return {
    version: 1,
    path: parseExecutionPath(config.path, path),
    configuredAt: typeof config.configuredAt === 'string' ? config.configuredAt : '',
  };
}

export function configuredExecutionPath(env: NodeJS.ProcessEnv = process.env): ExecutionPath {
  const override = env.MAJOR_EXECUTION_PATH?.trim();
  if (override) return parseExecutionPath(override, 'MAJOR_EXECUTION_PATH');
  return readConfig(env)?.path ?? 'host';
}

export function executionPathStatus(env: NodeJS.ProcessEnv = process.env): {
  path: ExecutionPath;
  source: 'environment' | 'config' | 'default';
  configPath: string;
} {
  const override = env.MAJOR_EXECUTION_PATH?.trim();
  if (override) {
    return {
      path: parseExecutionPath(override, 'MAJOR_EXECUTION_PATH'),
      source: 'environment',
      configPath: executionPathConfigPath(env),
    };
  }
  const config = readConfig(env);
  return {
    path: config?.path ?? 'host',
    source: config ? 'config' : 'default',
    configPath: executionPathConfigPath(env),
  };
}

export function persistExecutionPath(
  path: ExecutionPath,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): { path: ExecutionPath; configPath: string; configuredAt: string } {
  const configPath = executionPathConfigPath(env);
  const configuredAt = now().toISOString();
  const config: ExecutionPathConfig = { version: 1, path, configuredAt };
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, configPath);
  return { path, configPath, configuredAt };
}
